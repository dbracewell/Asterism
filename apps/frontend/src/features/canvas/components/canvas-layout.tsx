"use client";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import React from "react";
import { useCanvas } from "./canvas-context";
import { CanvasPanel } from "./canvas-panel";

/**
 * The chat beside its open canvas item: a resizable split on wider screens,
 * a full-screen sheet on mobile. The chat stays mounted in the first panel
 * either way, so opening the canvas keeps the transcript and draft.
 */
export function CanvasLayout({
  chatId,
  children,
}: {
  chatId: string;
  children: React.ReactNode;
}) {
  const canvas = useCanvas();
  const isMobile = useIsMobile();
  const itemId = canvas?.openItemId ?? null;
  const split = itemId != null && !isMobile;
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          id="chat"
          minSize="30"
          className="flex min-w-0 flex-col"
        >
          {children}
        </ResizablePanel>
        {split && (
          <>
            <ResizableHandle withHandle aria-label="Resize canvas" />
            <ResizablePanel
              id="canvas"
              defaultSize="45"
              minSize="25"
              className="bg-background flex min-w-0 flex-col border-l"
            >
              <CanvasPanel key={itemId} chatId={chatId} itemId={itemId} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {isMobile && (
        <Sheet
          open={itemId != null}
          onOpenChange={(open) => {
            if (!open) canvas?.close();
          }}
        >
          <SheetContent
            side="right"
            className="w-full p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-full"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Canvas</SheetTitle>
              <SheetDescription>
                The canvas item open beside this chat.
              </SheetDescription>
            </SheetHeader>
            {itemId && (
              <div className="h-full min-h-0">
                <CanvasPanel
                  key={itemId}
                  chatId={chatId}
                  itemId={itemId}
                  headerless
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
