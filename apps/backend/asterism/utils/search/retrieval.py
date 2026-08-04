import abc
import asyncio
import re
from dataclasses import dataclass

import bm25s
import networkx as nx
import Stemmer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from asterism.common import ToolContext
from asterism.llm.draft import get_draft_model


@dataclass
class PassageRetrievalResult:
    id: str
    content: str
    relevance: float


class PassageRetriever(abc.ABC):
    def __init__(self, ctx: ToolContext) -> None:
        super().__init__()
        self.ctx = ctx

    @abc.abstractmethod
    async def index_document(
        self,
        document_id: str,
        document_text: str,
    ) -> None: ...

    @abc.abstractmethod
    async def retrieve(
        self,
        top_k: int = 3,
    ) -> list[PassageRetrievalResult]: ...


class SummarizingRetriever(PassageRetriever):
    def __init__(self, ctx: ToolContext) -> None:
        super().__init__(ctx)
        self.documents: list[tuple[str, str]] = []

    async def index_document(
        self,
        document_id: str,
        document_text: str,
    ) -> None:
        self.documents.append((document_id, document_text))

    async def retrieve(
        self,
        top_k: int = 3,
    ) -> list[PassageRetrievalResult]:
        tasks = []
        document_ids: list[str] = []
        for doc_id, content in self.documents:
            document_ids.append(doc_id)
            summarization_prompt = f"""You are a research extraction assistant.
Analyze the following source documents and extract key facts, data, and answers directly relevant to the query.

User Query: "{self.ctx.user_message}"

Source Document:
{content}

Instructions:
- Provide a clear, bulleted summary of key findings.
- Ignore navigation text, cookie warnings, or unrelated boilerplate.
- Cite the source URL for major facts.
- Be concise and factual. Do not make up information.
    """  # noqa: E501
            tasks.append(self._generate(summarization_prompt))

        summaries: list[str] = await asyncio.gather(*tasks)
        results: list[PassageRetrievalResult] = []
        for doc_id, summary in zip(document_ids, summaries):
            if not summary.startswith("[ERROR"):
                results.append(
                    PassageRetrievalResult(
                        id=doc_id,
                        content=summary,
                        relevance=len(summary),
                    )
                )
        results.sort(key=lambda x: x.relevance, reverse=True)
        return results[: min(top_k, len(results))]

    async def _generate(self, prompt: str) -> str:
        try:
            summary = await self.ctx.client.generate(prompt)
            return summary
        except Exception as e:
            return f"[ERROR {e}]"


class BM25Retriever(PassageRetriever):
    def __init__(
        self,
        ctx: ToolContext,
        use_stemmer: bool = True,
    ) -> None:
        super().__init__(ctx)
        self.stemmer = Stemmer.Stemmer("english") if use_stemmer else None
        self.retrievers: list[bm25s.BM25] = []
        self.document_ids: list[str] = []
        self.chunks: list[list[str]] = []

    def _chunk_text(self, text: str) -> list[str]:
        raw_chunks = re.split(r"\n\s*\n", text)
        clean_chunks = [
            chunk.strip()
            for chunk in raw_chunks
            if len(chunk.strip().split()) > 5  # Must have more than 5 words
        ]
        return clean_chunks

    async def index_document(
        self,
        document_id: str,
        document_text: str,
    ) -> None:
        chunks = self._chunk_text(document_text)

        if not chunks:
            return

        self.document_ids.append(document_id)
        self.chunks.append(chunks)

        corpus_tokens = bm25s.tokenize(
            chunks,
            stemmer=self.stemmer,  # type: ignore
            stopwords="en",  # Removes common words like "the", "and"
        )

        retriever = bm25s.BM25()
        retriever.index(corpus_tokens)
        self.retrievers.append(retriever)

    async def retrieve(
        self,
        top_k: int = 3,
    ) -> list[PassageRetrievalResult]:
        if not self.retrievers:
            raise RuntimeError(
                "You must call index_document() before retrieving."
            )

        query_tokens = bm25s.tokenize(
            self.ctx.user_message,
            stemmer=self.stemmer,  # type: ignore
            stopwords="en",
        )

        retrieval_results: list[PassageRetrievalResult] = []
        for doc_id, doc_chunks, retriever in zip(
            self.document_ids,
            self.chunks,
            self.retrievers,
        ):
            results, scores = retriever.retrieve(
                query_tokens,
                k=min(top_k * 20, len(self.chunks)),
            )
            for i in range(len(results[0])):
                # results[0][i] contains the index of the original chunk
                chunk_idx = results[0][i]
                score = scores[0][i]
                # bm25s pads results with -1 if there aren't enough matches
                if chunk_idx == -1:
                    continue
                chunk_text = doc_chunks[chunk_idx]
                retrieval_results.append(
                    PassageRetrievalResult(
                        id=doc_id,
                        content=chunk_text,
                        relevance=float(score),
                    )
                )

        retrieval_results.sort(key=lambda x: x.relevance, reverse=True)
        return retrieval_results[: min(top_k, len(retrieval_results))]


class HeadingRetriever(PassageRetriever):
    def __init__(
        self,
        ctx: ToolContext,
        max_words_per_lead: int = 50,
    ) -> None:
        super().__init__(ctx)
        self.pattern = re.compile(
            r"(^(#{1,3})\s+(.+)$)\n+(^[^#\n].+)",
            re.MULTILINE,
        )
        self.documents: list[tuple[str, str]] = []
        self.max_words_per_lead: int = max_words_per_lead

    async def index_document(
        self,
        document_id: str,
        document_text: str,
    ) -> None:
        self.documents.append((document_id, document_text))

    async def retrieve(
        self,
        top_k: int = 3,
    ) -> list[PassageRetrievalResult]:
        retrieval_results: list[PassageRetrievalResult] = []
        for doc_id, doc_content in self.documents:
            matches = self.pattern.finditer(doc_content)
            score = 1
            for match in matches:
                header_level = len(match.group(2))
                header_text = match.group(3).strip()
                lead_paragraph = match.group(4).strip()

                # Clean up the lead paragraph: remove bold/italic markdown
                #  syntax for token efficiency
                clean_lead = re.sub(r"[*_]{1,2}", "", lead_paragraph)

                # Truncate long paragraphs to keep it strictly as a "lead"
                words = clean_lead.split()
                if len(words) > self.max_words_per_lead:
                    clean_lead = (
                        " ".join(words[: self.max_words_per_lead]) + "..."
                    )

                retrieval_results.append(
                    PassageRetrievalResult(
                        id=doc_id,
                        content=(
                            f"{'#' * header_level} {header_text}\n{clean_lead}"
                        ),
                        relevance=score / 100,
                    )
                )
                score += 1

        retrieval_results.sort(key=lambda x: x.relevance, reverse=True)
        return retrieval_results[: min(top_k, len(retrieval_results))]


class TextRankRetriever(PassageRetriever):
    def __init__(self, ctx: ToolContext, num_sentences: int = 5) -> None:
        super().__init__(ctx)
        self.documents: list[tuple[str, str]] = []
        self.num_sentences: int = num_sentences

    async def index_document(
        self, document_id: str, document_text: str
    ) -> None:
        self.documents.append((document_id, document_text))

    async def retrieve(
        self,
        top_k: int = 3,
    ) -> list[PassageRetrievalResult]:
        retrieval_results: list[PassageRetrievalResult] = []

        for doc_id, doc_content in self.documents:
            clean_text = re.sub(r"#+\s*", "", doc_content)
            clean_text = re.sub(r"[*_`\[\]]", "", clean_text)

            # Split by common sentence terminators (. ! ?) followed by
            # a space or newline
            sentences = re.split(r"(?<=[.!?])\s+", clean_text.strip())

            # Filter out empty or very short strings
            sentences = [s.strip() for s in sentences if len(s.split()) > 3]

            if len(sentences) <= self.num_sentences:
                retrieval_results.append(
                    PassageRetrievalResult(
                        id=doc_id,
                        content=" ".join(sentences),
                        relevance=1.0,
                    )
                )
                continue

            vectorizer = TfidfVectorizer(stop_words="english")
            tfidf_matrix = vectorizer.fit_transform(sentences)
            similarity_matrix = cosine_similarity(tfidf_matrix, tfidf_matrix)
            nx_graph = nx.from_numpy_array(similarity_matrix)
            scores = nx.pagerank(nx_graph)

            # 4. Extract Top Sentences
            # Sort sentences by their score, keeping their original index
            ranked_sentences = sorted(
                ((scores[i], i, s) for i, s in enumerate(sentences)),
                reverse=True,
            )

            # Select the top N sentences
            top_sentences = ranked_sentences[: self.num_sentences]

            # Sort the selected sentences back into
            # their original chronological order
            top_sentences.sort(key=lambda x: x[1])

            total_score = sum(x[0] for x in top_sentences)
            retrieval_results.append(
                PassageRetrievalResult(
                    id=doc_id,
                    content=" ".join(x[2] for x in top_sentences),
                    relevance=total_score,
                )
            )

        retrieval_results.sort(key=lambda x: x.relevance, reverse=True)
        return retrieval_results[: min(top_k, len(retrieval_results))]


class IntentBasedRetriever(PassageRetriever):
    def __init__(self, ctx: ToolContext) -> None:
        super().__init__(ctx)
        self.retriever: PassageRetriever | None = None

    async def _classify_prompt(self) -> str:
        draft_model = get_draft_model()
        return await draft_model.invoke(
            messages=[
                {
                    "role": "user",
                    "content": f"""Classify this query into one of three intents:
    BROAD_OVERVIEW: The user wants a general summary or the latest updates.
    SPECIFIC_FACT: The user is asking for a precise detail or answer.
    AMBIGUOUS: The query is too vague to determine a specific direction.
    Query: {self.ctx.user_message}""",  # noqa: E501
                }
            ]
        )

    async def _get_retriever(self) -> PassageRetriever:
        if self.retriever:
            return self.retriever
        intent = await self._classify_prompt()
        print(intent)
        if "BROAD_OVERVIEW" in intent.upper():
            self.retriever = TextRankRetriever(ctx=self.ctx)
            return self.retriever
        elif "SPECIFIC_FACT" in intent.upper():
            self.retriever = BM25Retriever(ctx=self.ctx)
            return self.retriever
        else:
            self.retriever = SummarizingRetriever(ctx=self.ctx)
            return self.retriever

    async def index_document(
        self,
        document_id: str,
        document_text: str,
    ) -> None:
        retriever = await self._get_retriever()
        return await retriever.index_document(
            document_id=document_id,
            document_text=document_text,
        )

    async def retrieve(
        self,
        top_k: int = 3,
    ) -> list[PassageRetrievalResult]:
        retriever = await self._get_retriever()
        return await retriever.retrieve(top_k=top_k)
