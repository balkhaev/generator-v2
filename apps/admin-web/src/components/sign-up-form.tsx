import { authClient } from "@generator/auth-client";
import AuthFrame from "@generator/ui/components/auth-frame";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";
import Loader from "./loader";

export default function SignUpForm({
	onSwitchToSignIn,
}: {
	onSwitchToSignIn: () => void;
}) {
	const router = useRouter();
	const { isPending } = authClient.useSession();

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
			name: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signUp.email(
				{
					email: value.email,
					password: value.password,
					name: value.name,
				},
				{
					onSuccess: () => {
						router.push("/");
						toast.success("Sign up successful");
					},
					onError: (error: {
						error: { message?: string; statusText?: string };
					}) => {
						toast.error(error.error.message || error.error.statusText);
					},
				}
			);
		},
		validators: {
			onSubmit: z.object({
				name: z.string().min(2, "Name must be at least 2 characters"),
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<AuthFrame
			label="Admin access"
			subtitle="Create an account for infra, queue, and asset release access."
			title="Create Generator Admin account"
		>
			<form
				className="grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					form.handleSubmit();
				}}
			>
				<form.Field name="name">
					{(field) => (
						<div className="grid gap-2">
							<Label htmlFor={field.name}>Name</Label>
							<Input
								autoComplete="name"
								id={field.name}
								name={field.name}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
							{field.state.meta.errors.map((error) => (
								<p className="text-rose-600 text-xs" key={error?.message}>
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="email">
					{(field) => (
						<div className="grid gap-2">
							<Label htmlFor={field.name}>Email</Label>
							<Input
								autoComplete="email"
								id={field.name}
								name={field.name}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								spellCheck={false}
								type="email"
								value={field.state.value}
							/>
							{field.state.meta.errors.map((error) => (
								<p className="text-rose-600 text-xs" key={error?.message}>
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="password">
					{(field) => (
						<div className="grid gap-2">
							<Label htmlFor={field.name}>Password</Label>
							<Input
								autoComplete="new-password"
								id={field.name}
								name={field.name}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								type="password"
								value={field.state.value}
							/>
							{field.state.meta.errors.map((error) => (
								<p className="text-rose-600 text-xs" key={error?.message}>
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button disabled={!canSubmit || isSubmitting} type="submit">
							{isSubmitting ? "Submitting..." : "Create account"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<Button onClick={onSwitchToSignIn} variant="outline">
				Already have an account? Sign in
			</Button>
		</AuthFrame>
	);
}
