import z from "zod";

export const UserAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.email(),
  password: z
    .string()
    .trim()
    .min(8, "Passwords must be between 8 and 16 characters")
    .max(16, "Passwords must be between 8 and 16 characters")
    .refine(
      (data) => /[a-z]/i.test(data),
      "Must contain at least 1 lower case letter",
    )
    .refine(
      (data) => /[A-Z]/i.test(data),
      "Must contain at least 1 upper case letter",
    )
    .refine((data) => /\d/i.test(data), "Must contain at least 1 digit")
    .refine(
      (data) => /[!@#$%^&*]/i.test(data),
      "Must contain at least 1 special character !@#$%^&*",
    ),
  role: z.enum(["user", "admin"]),
});

export type UserAccountSchemaType = z.infer<typeof UserAccountSchema>;
