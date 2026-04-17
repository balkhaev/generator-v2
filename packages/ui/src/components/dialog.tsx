"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@generator/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			className={cn(
				"data-open:fade-in-0 data-closed:fade-out-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-closed:animate-out data-open:animate-in",
				className
			)}
			data-slot="dialog-overlay"
			{...props}
		/>
	);
}

type DialogContentProps = DialogPrimitive.Popup.Props & {
	overlayClassName?: string;
	hideCloseButton?: boolean;
};

function DialogContent({
	className,
	overlayClassName,
	children,
	hideCloseButton = false,
	...props
}: DialogContentProps) {
	return (
		<DialogPortal>
			<DialogOverlay className={overlayClassName} />
			<DialogPrimitive.Popup
				className={cn(
					"data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 data-open:slide-in-from-bottom-4 fixed top-1/2 left-1/2 z-50 grid w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 gap-4 border border-border/60 bg-background p-0 text-foreground shadow-xl duration-200 data-closed:animate-out data-open:animate-in sm:rounded-md",
					className
				)}
				data-slot="dialog-content"
				{...props}
			>
				{children}
				{hideCloseButton ? null : (
					<DialogPrimitive.Close
						className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground opacity-70 outline-none transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none"
						data-slot="dialog-close-button"
					>
						<XIcon className="size-4" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				"flex flex-col gap-1.5 border-border/60 border-b px-5 py-4 text-left",
				className
			)}
			data-slot="dialog-header"
			{...props}
		/>
	);
}

function DialogFooter({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				"flex flex-col-reverse gap-2 border-border/60 border-t bg-muted/30 px-5 py-3 sm:flex-row sm:justify-end",
				className
			)}
			data-slot="dialog-footer"
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			className={cn(
				"font-semibold text-base text-foreground leading-tight tracking-tight",
				className
			)}
			data-slot="dialog-title"
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			className={cn("text-muted-foreground text-sm", className)}
			data-slot="dialog-description"
			{...props}
		/>
	);
}

function DialogBody({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("max-h-[70vh] overflow-y-auto px-5 py-4", className)}
			data-slot="dialog-body"
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
