import re
import uuid

from sqlalchemy import and_, desc, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import (
    BadDataException,
    NotFoundException,
    UnauthorizedException,
)
from asterism.db.database import get_async_db_session
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.service import ensure_file_processed
from asterism.domains.folders.models import FolderModel
from asterism.domains.settings.service import get_user_settings

from .models import (
    ChatModel,
    MessageModel,
)
from .schemas import (
    Chat,
    ChatInfo,
    ChatInfoList,
    ChatUpdateRequest,
    Message,
    MessageFileReference,
    MessageStatus,
    NewChatRequest,
    NewMessageRequest,
    SearchMatchSource,
    SearchResult,
    SearchResultKind,
    SearchResultList,
    UpdateMessageRequest,
)


async def add_message(
    user_id: str,
    chat_id: uuid.UUID,
    message: NewMessageRequest,
    session: AsyncSession | None = None,
) -> Message:
    async with get_async_db_session(session) as session:
        new_message = MessageModel(
            **message.model_dump(exclude={"active_child_id"}),
            user_id=user_id,
            chat_id=chat_id,
        )
        session.add(new_message)

        if new_message.parent_message_id:
            await session.flush()
            stmt = (
                update(MessageModel)
                .where(
                    MessageModel.id == new_message.parent_message_id,
                    MessageModel.user_id == user_id,
                    MessageModel.chat_id == chat_id,
                )
                .values(
                    active_child_id=new_message.id,
                    status=MessageStatus.COMPLETED,
                )
            )
            await session.execute(stmt)

        await session.commit()
        return Message.model_validate(new_message)


async def update_message(
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: UpdateMessageRequest,
    session: AsyncSession | None = None,
) -> Message:
    async with get_async_db_session(session) as session:
        update_stmt = (
            update(MessageModel)
            .where(
                MessageModel.id == message_id,
                MessageModel.user_id == user_id,
                MessageModel.chat_id == chat_id,
            )
            .values(**payload.model_dump(exclude_unset=True))
            .returning(MessageModel)
        )
        message = await session.scalar(update_stmt)
        await session.commit()
        return Message.model_validate(message)


async def create_chat(
    user_id: str,
    payload: NewChatRequest,
    session: AsyncSession | None = None,
) -> Chat:
    if not payload.user_prompt:
        raise BadDataException("User prompt cannot be empty")

    if len(payload.files) != len(set(payload.files)):
        raise BadDataException("Attached files must not be repeated")

    async with get_async_db_session(session) as session:
        agent_id = await _resolve_main_agent_id(
            user_id=user_id,
            requested_agent_id=payload.agent_id,
            session=session,
        )
        files: list[MessageFileReference] = []
        if payload.files:
            records = list(
                await session.scalars(
                    select(UserFileModel).where(
                        UserFileModel.user_id == user_id,
                        UserFileModel.filename.in_(payload.files),
                    )
                )
            )
            found = {file.filename: file for file in records}
            if any(filename not in found for filename in payload.files):
                raise BadDataException("One or more attached files are unavailable")
            for filename in payload.files:
                file = await ensure_file_processed(file=found[filename], session=session)
                files.append(
                    MessageFileReference(
                        filename=file.filename,
                        name=file.original_name,
                        mime_type=file.mime_type,
                        size=file.size,
                        kind=file.kind,
                        status=file.content_status,
                    )
                )

        new_session = ChatModel(
            user_id=user_id,
            agent_id=agent_id,
            folder_id=payload.folder_id,
        )
        session.add(new_session)
        await session.flush()

        new_message = MessageModel(
            chat_id=new_session.id,
            user_id=user_id,
            status=MessageStatus.PENDING,
            content=payload.user_prompt,
            role="user",
            token_count=0,
            files=files,
        )
        session.add(new_message)

        await session.commit()
        await session.refresh(new_session)
        await session.refresh(new_message)

        return Chat(
            info=ChatInfo.model_validate(new_session),
            messages=[Message.model_validate(new_message)],
        )


async def _resolve_main_agent_id(
    user_id: str,
    requested_agent_id: uuid.UUID | None,
    session: AsyncSession,
) -> uuid.UUID:
    if requested_agent_id is None:
        settings = await get_user_settings(user_id=user_id, session=session)
        requested_agent_id = settings.default_agent_id

    if requested_agent_id is None:
        raise BadDataException("Select a default main agent before starting a chat")

    agent = await get_agent_profile(
        user_id=user_id,
        agent_id=requested_agent_id,
        session=session,
    )
    if agent.sub_agent:
        raise BadDataException("A chat must use a main agent, not a sub-agent")
    return agent.id


async def update_chat(
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatUpdateRequest,
    session: AsyncSession | None = None,
) -> Chat:
    async with get_async_db_session(session) as session:
        update_stmt = (
            update(ChatModel)
            .where(
                ChatModel.user_id == user_id,
                ChatModel.id == chat_id,
            )
            .values(**payload.model_dump(exclude_unset=True))
            .returning(ChatModel)
        )
        chat_session = await session.scalar(update_stmt)
        await session.commit()

        return Chat(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def delete_chat(
    user_id: str,
    chat_id: uuid.UUID | None,
    session: AsyncSession | None = None,
) -> Chat:
    async with get_async_db_session(session) as session:
        chat_session = await session.get(ChatModel, chat_id)

        if not chat_session:
            raise NotFoundException(f"Chat with id {chat_id} not found")

        if chat_session.user_id != user_id:
            raise UnauthorizedException(
                f"User {user_id} is not authorized to delete chat session {chat_id}"
            )

        await session.delete(chat_session)
        await session.commit()

        return Chat(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def get_many(
    user_id: str,
    session: AsyncSession | None = None,
) -> ChatInfoList:
    async with get_async_db_session(session) as session:
        stmt = (
            select(ChatModel)
            .where(ChatModel.user_id == user_id, ChatModel.folder_id.is_(None))
            .order_by(desc(ChatModel.created_at))
        )
        result = await session.scalars(stmt)
        return ChatInfoList(chats=[ChatInfo.model_validate(r) for r in result.all()])


def _search_terms(query: str) -> list[str]:
    # Keyword search intentionally treats punctuation as separators and never
    # passes user input through as SQL/FTS syntax.
    return re.findall(r"[\w]+", query.casefold())[:10]


def _fts_query(terms: list[str]) -> str:
    return " AND ".join(f'"{term}"' for term in terms)


def _snippet(content: str, terms: list[str], limit: int = 180) -> str:
    normalized = content.replace("\n", " ").strip()
    if not normalized:
        return ""
    position = min(
        (normalized.casefold().find(term) for term in terms if term in normalized.casefold()),
        default=0,
    )
    start = max(0, position - 50)
    end = min(len(normalized), start + limit)
    prefix = "…" if start else ""
    suffix = "…" if end < len(normalized) else ""
    return f"{prefix}{normalized[start:end]}{suffix}"


async def search(
    user_id: str,
    query: str,
    page: int = 1,
    page_size: int = 20,
    session: AsyncSession | None = None,
) -> SearchResultList:
    terms = _search_terms(query)
    if not terms:
        return SearchResultList(results=[], total=0, page=page, page_size=page_size)

    async with get_async_db_session(session) as session:
        content_conditions = [
            MessageModel.content.ilike(f"%{term}%") for term in terms
        ]
        fts_query = _fts_query(terms)
        chat_ids = [
            uuid.UUID(value)
            for value in (
                await session.scalars(
                    text(
                        "SELECT chat_id FROM chat_search "
                        "WHERE user_id = :user_id AND chat_search MATCH :query"
                    ),
                    {"user_id": user_id, "query": fts_query},
                )
            ).all()
        ]
        folder_title_ids = {
            uuid.UUID(value)
            for value in (
                await session.scalars(
                    text(
                        "SELECT folder_id FROM folder_search "
                        "WHERE user_id = :user_id AND folder_search MATCH :query"
                    ),
                    {"user_id": user_id, "query": fts_query},
                )
            ).all()
        }
        matched_chats = []
        if chat_ids:
            matched_chats = list(
                await session.scalars(
                    select(ChatModel)
                    .where(ChatModel.user_id == user_id, ChatModel.id.in_(chat_ids))
                    .order_by(desc(ChatModel.updated_at))
                )
            )

        results: list[SearchResult] = []
        matching_folder_ids: set[uuid.UUID] = set()
        for chat in matched_chats:
            title = chat.title or "Untitled chat"
            title_matches = all(term in title.casefold() for term in terms)
            if title_matches:
                source = SearchMatchSource.TITLE
                snippet = title
            else:
                content = await session.scalar(
                    select(MessageModel.content)
                    .where(
                        MessageModel.chat_id == chat.id,
                        MessageModel.user_id == user_id,
                        and_(*content_conditions),
                    )
                    .order_by(MessageModel.created_at)
                    .limit(1)
                )
                source = SearchMatchSource.CONTENT
                snippet = _snippet(content or "", terms)
            results.append(
                SearchResult(
                    kind=SearchResultKind.CHAT,
                    id=chat.id,
                    title=title,
                    updated_at=chat.updated_at,
                    folder_id=chat.folder_id,
                    match_source=source,
                    snippet=snippet,
                )
            )
            if chat.folder_id:
                matching_folder_ids.add(chat.folder_id)

        folders = list(
            await session.scalars(
                select(FolderModel).where(FolderModel.user_id == user_id)
            )
        )
        folders_by_id = {folder.id: folder for folder in folders}
        # A match in a nested folder also makes every ancestor discoverable.
        for folder_id in list(matching_folder_ids):
            current = folders_by_id.get(folder_id)
            while current:
                matching_folder_ids.add(current.id)
                current = folders_by_id.get(current.parent_id)

        for folder in folders:
            title_matches = folder.id in folder_title_ids
            if not title_matches and folder.id not in matching_folder_ids:
                continue
            results.append(
                SearchResult(
                    kind=SearchResultKind.FOLDER,
                    id=folder.id,
                    title=folder.title,
                    updated_at=folder.updated_at,
                    folder_id=folder.parent_id,
                    match_source=(
                        SearchMatchSource.FOLDER_TITLE
                        if title_matches
                        else SearchMatchSource.CONTENT
                    ),
                    snippet=(
                        folder.title
                        if title_matches
                        else "Contains a matching chat"
                    ),
                )
            )

        def folder_path(folder_id: uuid.UUID | None) -> list[str]:
            path: list[str] = []
            current = folders_by_id.get(folder_id) if folder_id else None
            while current:
                path.append(current.title)
                current = folders_by_id.get(current.parent_id)
            return list(reversed(path))

        results = [
            result.model_copy(
                update={
                    "path": folder_path(
                        result.id if result.kind is SearchResultKind.FOLDER else result.folder_id
                    )
                }
            )
            for result in results
        ]
        results.sort(key=lambda result: result.updated_at, reverse=True)
        total = len(results)
        start = (page - 1) * page_size
        return SearchResultList(
            results=results[start : start + page_size],
            total=total,
            page=page,
            page_size=page_size,
        )


async def get_one(
    chat_id: uuid.UUID,
    user_id: str,
    session: AsyncSession | None = None,
) -> Chat:

    async with get_async_db_session(session) as session:
        chat_session = await session.get(ChatModel, chat_id)
        if not chat_session:
            raise NotFoundException()
        if chat_session.user_id != user_id:
            raise UnauthorizedException()

        chat_info = ChatInfo.model_validate(chat_session)

        stmt = select(MessageModel).where(
            MessageModel.chat_id == chat_id,
            MessageModel.user_id == user_id,
        )
        result = await session.execute(stmt)
        all_messages = result.scalars().all()

        if not all_messages:
            return Chat(
                info=chat_info,
                messages=[],
            )

        message_map = {msg.id: msg for msg in all_messages}
        children_map: dict[uuid.UUID | None, list[MessageModel]] = {}
        for msg in all_messages:
            parent_id = msg.parent_message_id
            if parent_id not in children_map:
                children_map[parent_id] = []
            children_map[parent_id].append(msg)

        for parent_id in children_map:
            children_map[parent_id].sort(key=lambda x: x.created_at)

        root_messages = children_map.get(None, [])
        if not root_messages:
            return Chat(
                info=chat_info,
                messages=[],
            )

        current_node = root_messages[0]
        active_thread: list[Message] = []

        while current_node is not None:
            parent_id = current_node.parent_message_id
            thread_msg = Message.model_validate(current_node)
            siblings = children_map.get(parent_id, [])
            node_index = siblings.index(current_node)
            thread_msg.has_siblings = len(siblings) > 1
            thread_msg.sibling_count = len(siblings)
            thread_msg.current_sibling_index = node_index + 1
            thread_msg.next_sibling_id = (
                siblings[node_index + 1].id if node_index + 1 < len(siblings) else None
            )
            thread_msg.previous_sibling_id = (
                siblings[node_index - 1].id if node_index - 1 >= 0 else None
            )
            active_thread.append(thread_msg)

            if (
                current_node.active_child_id
                and current_node.active_child_id in message_map
            ):
                current_node = message_map[current_node.active_child_id]
            else:
                break

        return Chat(
            info=chat_info,
            messages=active_thread,
        )
