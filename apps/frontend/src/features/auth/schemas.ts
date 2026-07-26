import z from "zod";

export const BaseUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.email(),
  password: z
    .string()
    .trim()
    .min(8, "Passwords must be between 8 and 32 characters")
    .max(32, "Passwords must be between 8 and 32 characters")
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
});

export const InstallUserSchema = BaseUserSchema.extend({
  adminKey: z.string().trim().min(1, "AdminKey is required"),
});

export type InstallUserSchemaType = z.infer<typeof InstallUserSchema>;

export const UserAccountSchema = BaseUserSchema.extend({
  role: z.enum(["user", "admin"]),
});

export type UserAccountSchemaType = z.infer<typeof UserAccountSchema>;
