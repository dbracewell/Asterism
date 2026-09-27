import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { SearchIcon, XIcon } from "lucide-react";

type HeaderProps = {
  query: string;
  setQuery: (query: string) => void;
  sort: "name" | "created";
  setSort: (sort: "name" | "created") => void;
};

export const Header = ({ query, setQuery, sort, setSort }: HeaderProps) => {
  return (
    <header className="bg-accent flex flex-col">
      <h1 className="bg-accent text-accent-foreground border-b px-4 py-2 text-lg font-bold">
        Knowledge Bases
      </h1>
      <div className="bg-background flex flex-wrap items-end gap-2 p-2">
        <div className="flex flex-col gap-0.5 border-r">
          <span className="text-muted-foreground text-center text-xs">
            Sort by
          </span>
          <div className="flex gap-1">
            <Button
              aria-label="Sort by name"
              className="h-7!"
              onClick={() => setSort("name")}
              size="sm"
              variant={sort === "name" ? "link" : "ghost"}
            >
              Name
            </Button>
            <Button
              aria-label="Sort by date created"
              className="h-7!"
              onClick={() => setSort("created")}
              size="sm"
              variant={sort === "created" ? "link" : "ghost"}
            >
              Created
            </Button>
          </div>
        </div>
        <div className="min-w-56 flex-1">
          <InputGroup>
            <InputGroupInput
              aria-label="Search knowledge bases"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search knowledge bases..."
              value={query}
            />
            <InputGroupAddon align="inline-start">
              <SearchIcon className="text-muted-foreground" />
            </InputGroupAddon>
            {query && (
              <InputGroupAddon align="inline-end">
                <Button
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  size="icon"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
      </div>
    </header>
  );
};
