"use client";

import { Button } from "@generator/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { Checkbox } from "@generator/ui/components/checkbox";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { cn } from "@generator/ui/lib/utils";
import { ChevronDown, Loader2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useCreateAdminUser } from "@/hooks/use-admin-users";

export default function UserForm() {
	const create = useCreateAdminUser();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [emailVerified, setEmailVerified] = useState(true);
	const [open, setOpen] = useState(false);

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
			setName("");
			setEmail("");
			setPassword("");
			setEmailVerified(true);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to create user"
			);
		}
	}

	return (
		<Card>
			<CardHeader className="p-0">
				<button
					aria-controls="add-user-form"
					aria-expanded={open}
					className="flex w-full items-start gap-3 rounded-none px-4 py-4 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					onClick={() => setOpen((value) => !value)}
					type="button"
				>
					<span className="grid min-w-0 flex-1 gap-1">
						<CardTitle>Add user</CardTitle>
						<CardDescription>
							Create a new admin operator with email/password credentials.
						</CardDescription>
					</span>
					<ChevronDown
						aria-hidden="true"
						className={cn(
							"mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
							open ? "rotate-180" : ""
						)}
					/>
				</button>
			</CardHeader>
			<form
				className={open ? "contents" : "hidden"}
				id="add-user-form"
				onSubmit={handleSubmit}
			>
				<CardContent className="grid gap-3 md:grid-cols-2">
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
				</CardContent>
				<CardFooter>
					<Button disabled={create.isPending} type="submit">
						{create.isPending ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<UserPlus data-icon="inline-start" />
						)}
						Create user
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
