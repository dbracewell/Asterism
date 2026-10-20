"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { VariantProps } from "class-variance-authority";
import React, { useCallback, useRef, useState } from "react";

export interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmVariant?: VariantProps<typeof buttonVariants>["variant"];
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmVariant,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const isConfirmingRef = useRef(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (!isConfirmingRef.current) {
        onCancel();
      }
      isConfirmingRef.current = false;
    }
    onOpenChange(nextOpen);
  };

  const handleConfirmClick = () => {
    isConfirmingRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            onClick={handleConfirmClick}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function useConfirmationDialog({
  title,
  description,
  confirmVariant,
  confirmText = "Confirm",
  cancelText = "Cancel",
}: {
  title: string;
  description: string;
  confirmVariant?: VariantProps<typeof buttonVariants>["variant"];
  confirmText?: string;
  cancelText?: string;
}) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(() => {
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolver.current?.(true);
    resolver.current = null;
    setOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    resolver.current?.(false);
    resolver.current = null;
    setOpen(false);
  }, []);

  const dialog = (
    <ConfirmationDialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
      confirmVariant={confirmVariant}
      confirmText={confirmText}
      cancelText={cancelText}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, dialog };
}
