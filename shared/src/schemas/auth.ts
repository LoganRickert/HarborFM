import { z } from 'zod';

export const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
  captchaToken: z.string().optional(),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, { message: 'Password is required' }),
  captchaToken: z.string().optional(),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().min(1, { message: 'Email is required' }).email(),
  captchaToken: z.string().optional(),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
