"use client";

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
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { Loader2, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { useCreateAdminUser } from "@/hooks/use-admin-users";

export default function UserForm({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const create = useCreateAdminUser();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [emailVerified, setEmailVerified] = useState(true);

	useEffect(() => {
		if (!open) {
			setName("");
			setEmail("");
			setPassword("");
			setEmailVerified(true);
		}
	}, [open]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmedName = name.trim();
		const trimmedEmail = email.trim();
		if (!(trimmedName && trimmedEmail && password)) {
			toast.error("Name, email and password are required");
			return;
		}
		try {
			const user = await create.mutateAsync({
				email: trimmedEmail,
				emailVerified,
				name: trimmedName,
				password,
			});
			toast.success(`Created user "${user.name}"`);
			onOpenChange(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to create user"
			);
		}
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-lg">
				<form id="add-user-form" onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create user</DialogTitle>
						<DialogDescription>
							Add a new admin operator with email/password credentials.
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-3 md:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="user-name">Name</Label>
							<Input
								autoComplete="off"
								id="user-name"
								onChange={(event) => setName(event.target.value)}
								placeholder="Jane Doe"
								value={name}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="user-email">Email</Label>
							<Input
								autoComplete="off"
								id="user-email"
								onChange={(event) => setEmail(event.target.value)}
								placeholder="jane@example.com"
								type="email"
								value={email}
							/>
						</div>
						<div className="grid gap-1.5 md:col-span-2">
							<Label htmlFor="user-password">Password</Label>
							<Input
								autoComplete="new-password"
								id="user-password"
								minLength={8}
								onChange={(event) => setPassword(event.target.value)}
								placeholder="At least 8 characters"
								type="password"
								value={password}
							/>
						</div>
						<label
							className="flex items-center gap-2 text-xs md:col-span-2"
							htmlFor="user-email-verified"
						>
							<Checkbox
								checked={emailVerified}
								id="user-email-verified"
								onCheckedChange={(value) => setEmailVerified(value === true)}
							/>
							Mark email as verified
						</label>
					</DialogBody>
					<DialogFooter>
						<Button
							disabled={create.isPending}
							onClick={() => onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={create.isPending} type="submit">
							{create.isPending ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<UserPlus data-icon="inline-start" />
							)}
							Create user
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
