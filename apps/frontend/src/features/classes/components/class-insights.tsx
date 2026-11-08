"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { client } from "@/lib/api";
import { classInsightsGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { HelpHeading } from "@/features/help/components/help-heading";

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Where consenting students struggle, by course file; totals only (US-60.5). */
export function ClassInsights({ classId }: { classId: string }) {
  const insights = useQuery({
    ...classInsightsGetOptions({ client, path: { class_id: classId } }),
    retry: false,
  });
  return (
    <section aria-label="Class insights" className="grid gap-3">
      <HelpHeading
        help="concept.class-insights"
        className="text-lg font-medium"
      >
        Where the class struggles
      </HelpHeading>
      <p className="text-sm">
        Totals from students who chose to share their flashcard and quiz
        results, grouped by the course file the practice came from. You never
        see chats, answers or any one student&apos;s results.
      </p>
      {insights.isPending && <ListSkeleton label="Loading insights" rows={2} />}
      {insights.error && (
        <QueryError
          error={insights.error}
          message="Could not load insights."
          retry={insights.refetch}
          isRetrying={insights.isFetching}
        />
      )}
      {insights.data &&
        (insights.data.consenting_students < insights.data.min_group_size ? (
          <p className="text-muted-foreground text-sm">
            Insights appear once at least {insights.data.min_group_size}{" "}
            students share their results. {insights.data.consenting_students}{" "}
            {insights.data.consenting_students === 1 ? "has" : "have"} so far.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {insights.data.consenting_students} students are sharing.
            </p>
            {insights.data.topics.length === 0 ? (
              <p className="text-sm">
                No course file has practice from {insights.data.min_group_size}{" "}
                or more of them yet.
              </p>
            ) : (
              <ul
                aria-label="Course files, weakest first"
                className="grid gap-2"
              >
                {insights.data.topics.map((topic) => (
                  <li key={topic.name} className="border-b pb-2 text-sm">
                    <p className="font-medium wrap-anywhere">{topic.name}</p>
                    <p className="text-muted-foreground">
                      Average score {percent(topic.average_score)} ·{" "}
                      {percent(topic.needs_work_share)} need more work ·{" "}
                      {topic.students} students
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {insights.data.hidden_topics > 0 && (
              <p className="text-muted-foreground text-sm">
                {insights.data.hidden_topics} more{" "}
                {insights.data.hidden_topics === 1 ? "file has" : "files have"}{" "}
                too few students to show.
              </p>
            )}
          </>
        ))}
    </section>
  );
}
