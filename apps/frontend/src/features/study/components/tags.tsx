import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { parseTags, tagProblem } from "../lib/tags";

/** Comma-separated topic tags for a deck or quiz (US-58.3). */
export function TagsField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const problem = tagProblem(parseTags(value));
  return (
    <Field>
      <FieldLabel htmlFor={id}>Topics</FieldLabel>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={!!problem}
        aria-describedby={`${id}-help`}
        placeholder="For example: cell biology, energy"
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription id={`${id}-help`}>
        {problem ??
          "Separate topics with commas. Topic mastery on the project page groups results by them."}
      </FieldDescription>
    </Field>
  );
}

export function TagList({ tags }: { tags: readonly string[] }) {
  if (!tags.length) return null;
  return (
    <ul aria-label="Topics" className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="outline">{tag}</Badge>
        </li>
      ))}
    </ul>
  );
}
