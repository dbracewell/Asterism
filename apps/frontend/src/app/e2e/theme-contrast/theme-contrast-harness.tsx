"use client";

import { FullLogo } from "@/components/full-logo";
import MarkdownViewer from "@/components/markdown-viewer";
import {
  adversarialMarkdown,
  fencedCode,
  normalMarkdown,
} from "@/components/markdown-viewer/test-content";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";
import { useState } from "react";
import { ChatModelPicker } from "@/features/chat/components/chat-model-picker";
import { StreamingIndicator } from "@/features/chat/components/message/streaming-indicator";
import { ThemeGallery } from "@/components/settings/theme-gallery";
import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ModelSelector } from "@/components/settings/model-selector";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/features/theme/components/theme-context";

// A bounded palette review surface using production components and the real
// cookie-selected theme. No substitute component colors or fixture-only CSS.
export function ThemeContrastHarness() {
  const { currentTheme } = useTheme();
  const { getSearchParam } = useReadWriteSearchParams();
  const pane = Number(getSearchParam("pane")) || 1440;
  const [chatModel, setChatModel] = useState("contrast-model");
  return (
    <main
      className="@container/review h-dvh min-w-0 scroll-p-3 overflow-auto p-4"
      style={{ width: `min(100%, ${pane}px)` }}
      data-testid="palette-review"
    >
      <h1 className="mb-4 text-xl font-semibold">
        Palette review: {currentTheme}
      </h1>
      <div className="grid min-w-0 grid-cols-1 gap-4 @3xl/review:grid-cols-[220px_minmax(0,1fr)]">
        <SidebarProvider className="min-h-0">
          <aside
            className="bg-sidebar text-sidebar-foreground rounded-surface w-full p-4"
            aria-label="Review sidebar"
          >
            <SidebarGroupLabel data-contrast="sidebar-label">
              Workspace
            </SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton data-contrast="sidebar-selected" isActive>
                  Selected project
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton data-contrast="sidebar-hover">
                  Other project
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <p
              className="bg-sidebar-primary text-sidebar-primary-foreground rounded-control mt-4 p-2"
              data-contrast="sidebar-primary"
            >
              New conversation
            </p>
          </aside>
        </SidebarProvider>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Settings and actions</CardTitle>
            <CardDescription data-contrast="card-muted">
              Supporting text remains readable.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <Button data-contrast="primary">Save changes</Button>
              <Button variant="secondary" data-contrast="secondary">
                Preview
              </Button>
              <Button variant="outline" data-contrast="outline">
                Cancel
              </Button>
              <Button variant="destructive" data-contrast="destructive">
                Delete file
              </Button>
              <Button variant="link" data-contrast="link">
                View details
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Badge data-contrast="badge-primary">Ready</Badge>
              <Badge variant="secondary" data-contrast="badge-secondary">
                Processing
              </Badge>
              <Badge variant="destructive" data-contrast="badge-destructive">
                Failed
              </Badge>
              <Badge variant="outline" data-contrast="badge-outline">
                Embedded
              </Badge>
              <Badge variant="outline" asChild data-contrast="badge-link">
                <Link href="/e2e/theme-contrast">Project badge</Link>
              </Badge>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 @xl/review:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="review-input">Project name</Label>
                <Input
                  id="review-input"
                  placeholder="Enter a name"
                  data-contrast="input"
                />
                <Label htmlFor="review-notes">Notes</Label>
                <Textarea
                  id="review-notes"
                  placeholder="Add notes"
                  data-contrast="textarea"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="review-model">Model</Label>
                <Select>
                  <SelectTrigger id="review-model" data-contrast="select">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="review" data-contrast="select-option">
                        Review model
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Label htmlFor="review-search">Search</Label>
                <InputGroup data-contrast="input-group">
                  <InputGroupInput
                    id="review-search"
                    placeholder="Find a file"
                    data-contrast="group-control"
                  />
                </InputGroup>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="review-checkbox"
                    defaultChecked
                    data-contrast="checkbox"
                  />
                  <Label htmlFor="review-checkbox">Include attachments</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="review-switch"
                    defaultChecked
                    data-contrast="switch"
                  />
                  <Label htmlFor="review-switch">Enable tools</Label>
                </div>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 @3xl/review:grid-cols-3">
              <div
                data-testid="appearance-theme"
                className="flex flex-col gap-2 @3xl/review:col-span-3"
              >
                <Label id="review-theme" asChild>
                  <span>Theme</span>
                </Label>
                <ThemeGallery
                  labelId="review-theme"
                  currentTheme={currentTheme}
                />
              </div>
              <div
                data-testid="appearance-size"
                className="flex flex-col gap-2"
              >
                <Label htmlFor="review-size">Text size</Label>
                <FontSizeSelector id="review-size" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="review-settings-model">Main model</Label>
                <ModelSelector
                  id="review-settings-model"
                  value="palette-model"
                  onValueChange={() => {}}
                  availableModels={[
                    {
                      id: "palette-model",
                      name: "Palette model",
                      provider_id: "palette-provider",
                      provider_name: "Synthetic provider",
                      provider_type: "generic_openai",
                    },
                  ]}
                />
              </div>
            </div>
            <div data-testid="pending-reply">
              <StreamingIndicator variant="turn" />
            </div>
            <div data-testid="composer">
              <ChatInputContainer>
                <ChatInput
                  requestScope="palette-review"
                  onSubmit={() => {}}
                  placeholder="Write a message"
                  modelSelector={
                    <ChatModelPicker
                      value={chatModel}
                      onChange={setChatModel}
                    />
                  }
                />
              </ChatInputContainer>
            </div>
            <Tabs defaultValue="general">
              <TabsList className="max-w-full overflow-x-auto">
                <TabsTrigger value="general" data-contrast="tab-selected">
                  General
                </TabsTrigger>
                <TabsTrigger value="advanced" data-contrast="tab-inactive">
                  Advanced
                </TabsTrigger>
              </TabsList>
              <TabsContent value="general">General configuration</TabsContent>
              <TabsContent value="advanced">Advanced configuration</TabsContent>
            </Tabs>
            <div className="bg-muted rounded-surface flex flex-col gap-3 p-4">
              <p className="text-muted-foreground" data-contrast="muted">
                Muted labels on a muted surface
              </p>
              <Button
                variant="destructive"
                className="h-auto min-h-7 whitespace-normal"
                data-contrast="destructive-muted"
              >
                Remove attachment
              </Button>
            </div>
            <p role="alert" className="text-destructive" data-contrast="error">
              Could not save. Try again.
            </p>
            <div
              className="bg-popover text-popover-foreground rounded-surface border p-4"
              data-contrast="popover"
            >
              Popover content uses its paired text role.
            </div>
            <section
              aria-label="Typography and content review"
              className="min-w-0"
            >
              <FullLogo />
              <div
                role="region"
                aria-label="Review rich content"
                tabIndex={0}
                className="focus-visible:outline-ring rounded-control max-h-64 min-w-0 overflow-auto border p-2 focus-visible:outline-2"
              >
                <MarkdownViewer
                  content={
                    normalMarkdown +
                    "\n" +
                    fencedCode +
                    "\n" +
                    adversarialMarkdown +
                    "\n" +
                    "long-content-".repeat(80) +
                    "\n\n| Wide value | Result |\n| --- | --- |\n| " +
                    "column".repeat(60) +
                    " | 42 |"
                  }
                />
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
