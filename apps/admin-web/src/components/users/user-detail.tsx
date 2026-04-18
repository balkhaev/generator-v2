"use client";

import type { AdminUser } from "@generator/contracts/admin";
import { Button } from "@generator/ui/components/button";
import { Checkbox } from "@generator/ui/components/checkbox";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@generator/ui/components/dialog";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatDateTime } from "@generator/ui/lib/format";
import { KeyRound, Loader2, Save, Trash2, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import {
	useDeleteAdminUser,
	useResetAdminUserPassword,
	useUpdateAdminUser,
} from "@/hooks/use-admin-users";

interface FormState {
	email: string;
	emailVerified: boolean;
	name: string;
}

function toFormState(user: AdminUser): FormState {
	return {
		email: user.email,
		emailVerified: user.emailVerified,
		name: user.name,
	};
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid gap-1">
			<SectionLabel>{label}</SectionLabel>
			<div className="break-all text-xs">{value}</div>
		</div>
	);
}

export default function UserDetail({
	currentUserId,
	user,
}: {
	currentUserId: string | null;
	user: AdminUser | null;
}) {
	if (!user) {
		return (
			<div className="grid h-full place-items-center px-4 py-8">
				<EmptyState
					hint="Select a user on the left to inspect or edit."
					icon={Users}
					message="No user selected"
				/>
			</div>
		);
	}

	return <UserEditor currentUserId={currentUserId} key={user.id} user={user} />;
}

function UserEditor({
	currentUserId,
	user,
}: {
	currentUserId: string | null;
	user: AdminUser;
}) {
	const update = useUpdateAdminUser();
	const remove = useDeleteAdminUser();
	const resetPassword = useResetAdminUserPassword();
	const [form, setForm] = useState<FormState>(() => toFormState(user));
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [passwordOpen, setPasswordOpen] = useState(false);
	const [newPassword, setNewPassword] = useState("");

	useEffect(() => {
		setForm(toFormState(user));
	}, [user]);

	const isCurrentUser = user.id === currentUserId;
	const isDirty =
		form.name.trim() !== user.name ||
		form.email.trim().toLowerCase() !== user.email ||
		form.emailVerified !== user.emailVerified;
	const isBusy =
		update.isPending || remove.isPending || resetPassword.isPending;

	async function handleSave() {
		const trimmedName = form.name.trim();
		const trimmedEmail = form.email.trim().toLowerCase();
		if (!(trimmedName && trimmedEmail)) {
			toast.error("Name and email are required");
			return;
		}
		try {
			await update.mutateAsync({
				id: user.id,
				patch: {
					email: trimmedEmail,
					emailVerified: form.emailVerified,
					name: trimmedName,
				},
			});
			toast.success("User updated");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to update user"
			);
		}
	}

	async function handleDelete() {
		try {
			await remove.mutateAsync(user.id);
			toast.success("User deleted");
			setConfirmOpen(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete user"
			);
		}
	}

	async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (newPassword.length < 8) {
			toast.error("Password must be at least 8 characters");
			return;
		}
		try {
			await resetPassword.mutateAsync({
				id: user.id,
				input: { password: newPassword },
			});
			toast.success("Password updated");
			setNewPassword("");
			setPasswordOpen(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to update password"
			);
		}
	}

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
			<div className="border-foreground/6 border-b px-4 py-3 dark:border-foreground/10">
				<div className="flex items-center justify-between gap-2">
					<SectionLabel>Inspector</SectionLabel>
					<div className="flex items-center gap-2">
						{isCurrentUser ? <StatusBadge tone="info">you</StatusBadge> : null}
						<StatusBadge tone={user.emailVerified ? "success" : "warning"}>
							{user.emailVerified ? "verified" : "unverified"}
						</StatusBadge>
					</div>
				</div>
			</div>

			<div className="grid min-h-0 gap-5 overflow-y-auto px-4 py-4">
				<section className="grid gap-3">
					<SectionLabel>Edit</SectionLabel>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="user-edit-name">
							Name
						</Label>
						<Input
							id="user-edit-name"
							onChange={(event) =>
								setForm((prev) => ({ ...prev, name: event.target.value }))
							}
							value={form.name}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="user-edit-email">
							Email
						</Label>
						<Input
							id="user-edit-email"
							onChange={(event) =>
								setForm((prev) => ({ ...prev, email: event.target.value }))
							}
							type="email"
							value={form.email}
						/>
					</div>
					<label
						className="flex items-center gap-2 text-xs"
						htmlFor="user-edit-verified"
					>
						<Checkbox
							checked={form.emailVerified}
							id="user-edit-verified"
							onCheckedChange={(value) =>
								setForm((prev) => ({
									...prev,
									emailVerified: value === true,
								}))
							}
						/>
						Email verified
					</label>
				</section>

				<section className="grid gap-3">
					<SectionLabel>Metadata</SectionLabel>
					<Field
						label="ID"
						value={<code className="text-[11px]">{user.id}</code>}
					/>
					<Field
						label="Sessions"
						value={
							<span>
								{user.sessionsCount} active session
								{user.sessionsCount === 1 ? "" : "s"}
							</span>
						}
					/>
					<Field
						label="Linked accounts"
						value={
							<span>
								{user.accountsCount} account
								{user.accountsCount === 1 ? "" : "s"}{" "}
								{user.hasPassword ? "(credential set)" : "(no password)"}
							</span>
						}
					/>
					<Field label="Created" value={formatDateTime(user.createdAt)} />
					<Field label="Updated" value={formatDateTime(user.updatedAt)} />
				</section>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 border-foreground/6 border-t bg-muted/20 px-4 py-3 dark:border-foreground/10">
				<div className="flex items-center gap-2">
					<Button disabled={!isDirty || isBusy} onClick={handleSave} size="sm">
						{update.isPending ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Save data-icon="inline-start" />
						)}
						Save
					</Button>
					<Button
						disabled={isBusy}
						onClick={() => setPasswordOpen(true)}
						size="sm"
						variant="outline"
					>
						<KeyRound data-icon="inline-start" />
						Reset password
					</Button>
				</div>
				<Button
					disabled={isBusy || isCurrentUser}
					onClick={() => setConfirmOpen(true)}
					size="sm"
					title={
						isCurrentUser ? "You cannot delete your own account" : undefined
					}
					variant="ghost"
				>
					<Trash2 data-icon="inline-start" />
					Delete
				</Button>
			</div>

			<Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Delete &ldquo;{user.name}&rdquo;?</DialogTitle>
						<DialogDescription>
							This permanently removes the user and all their sessions and
							credentials. This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setConfirmOpen(false)}
							size="sm"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={remove.isPending}
							onClick={handleDelete}
							size="sm"
						>
							{remove.isPending ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Trash2 data-icon="inline-start" />
							)}
							Delete permanently
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setPasswordOpen} open={passwordOpen}>
				<DialogContent className="max-w-md">
					<form onSubmit={handlePasswordSubmit}>
						<DialogHeader>
							<DialogTitle>Reset password</DialogTitle>
							<DialogDescription>
								Set a new password for &ldquo;{user.name}&rdquo;. They will need
								to use this password on the next sign-in.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="grid gap-1.5">
								<Label htmlFor="user-new-password">New password</Label>
								<Input
									autoComplete="new-password"
									id="user-new-password"
									minLength={8}
									onChange={(event) => setNewPassword(event.target.value)}
									placeholder="At least 8 characters"
									type="password"
									value={newPassword}
								/>
							</div>
						</DialogBody>
						<DialogFooter>
							<Button
								onClick={() => setPasswordOpen(false)}
								size="sm"
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={resetPassword.isPending}
								size="sm"
								type="submit"
							>
								{resetPassword.isPending ? (
									<Loader2 className="animate-spin" data-icon="inline-start" />
								) : (
									<KeyRound data-icon="inline-start" />
								)}
								Update password
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
