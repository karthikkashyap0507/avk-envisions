'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { InlineError } from '@/components/ui/states';
import { ApiClientError, api, applyFieldErrors } from '@/lib/api-client';
import { HEARD_ABOUT_LABELS, HEARD_ABOUT_OTHER_MAX, HeardAbout } from '@/lib/enums';
import { registerSchema, type RegisterInput } from '@/validations/auth';

import { PasswordStrength } from './password-strength';

interface RegisterResponse {
  userId: string;
  emailVerificationRequired: boolean;
  redirectTo: string;
}

const FIELDS = [
  'name',
  'email',
  'phone',
  'password',
  'confirmPassword',
  'heardAbout',
  'heardAboutOther',
  'acceptTerms',
] as const;

export function RegisterForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    // The identical schema runs again server-side; this is for fast feedback.
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      heardAbout: [],
      heardAboutOther: '',
    },
    mode: 'onBlur',
  });

  const password = watch('password') ?? '';
  const acceptTerms = watch('acceptTerms');
  const heardAbout = watch('heardAbout') ?? [];

  function toggleHeardAbout(code: HeardAbout, on: boolean) {
    const next = on ? [...heardAbout, code] : heardAbout.filter((c) => c !== code);
    setValue('heardAbout', HeardAbout.values.filter((c) => next.includes(c)), { shouldDirty: true });
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const data = await api.post<RegisterResponse>('/api/auth/register', values);

      toast.success(
        data.emailVerificationRequired
          ? 'Account created. Check your inbox to verify your email.'
          : 'Account created. Welcome to AVK Envisions.',
      );

      router.replace(data.redirectTo || '/dashboard');
      router.refresh();
    } catch (error) {
      if (applyFieldErrors(error, setError as never, FIELDS as unknown as string[])) return;

      setError('root', {
        type: 'server',
        message:
          error instanceof ApiClientError
            ? error.message
            : 'We could not create your account. Please try again.',
      });
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Free to start. No card required.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        {errors.root && <InlineError message={errors.root.message ?? 'Registration failed.'} />}

        <FormField label="Full name" htmlFor="name" error={errors.name?.message} required>
          <Input
            autoComplete="name"
            placeholder="Ananya Sharma"
            startIcon={<User />}
            invalid={Boolean(errors.name)}
            {...register('name')}
          />
        </FormField>

        <FormField label="Email address" htmlFor="email" error={errors.email?.message} required>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            startIcon={<Mail />}
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </FormField>

        <FormField label="Mobile number" htmlFor="phone" error={errors.phone?.message} required>
          <Input
            id="phone"
            type="tel"
            // `numeric` rather than `tel`: the tel keypad offers +*# which are
            // not wanted here, and the field takes ten digits only.
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel-national"
            placeholder="10-digit mobile number"
            // A fixed label, not a prefilled value: typing "+91" again then
            // becomes impossible rather than merely wrong, and what is stored
            // is always the ten digits beside it.
            startIcon={<span className="text-sm font-medium tabular-nums">+91</span>}
            className="pl-12"
            invalid={Boolean(errors.phone)}
            {...register('phone')}
          />
        </FormField>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium leading-none">
            Password
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          </label>
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Create a strong password"
            startIcon={<Lock />}
            invalid={Boolean(errors.password)}
            endIcon={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="rounded p-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            }
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs font-medium text-destructive">{errors.password.message}</p>
          )}
          <PasswordStrength password={password} className="pt-1" />
        </div>

        <FormField
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
          required
        >
          <Input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Re-enter your password"
            startIcon={<Lock />}
            invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
        </FormField>

        {/* Optional, and any number may be ticked. Asked here rather than
            after signup because this is the one moment every new student is
            on a form — and the admin Users page reads the answer back. */}
        <div className="rounded-xl border border-primary/15 bg-primary-muted/40 p-4">
          <fieldset>
            <legend className="text-sm font-semibold">How did you hear about us?</legend>
            <div className="mt-3 space-y-2.5">
              {HeardAbout.values.map((code) => (
                <div key={code} className="flex items-start gap-2.5">
                  <Checkbox
                    id={`heard-${code}`}
                    checked={heardAbout.includes(code)}
                    onCheckedChange={(checked) => toggleHeardAbout(code, checked === true)}
                  />
                  <label htmlFor={`heard-${code}`} className="text-sm leading-snug">
                    {HEARD_ABOUT_LABELS[code]}
                  </label>
                </div>
              ))}
            </div>

            {heardAbout.includes('OTHER') && (
              <div className="mt-3 space-y-1.5 pl-7">
                <label htmlFor="heardAboutOther" className="sr-only">
                  Where did you hear about us?
                </label>
                <Input
                  id="heardAboutOther"
                  maxLength={HEARD_ABOUT_OTHER_MAX}
                  placeholder="Where? (optional)"
                  invalid={Boolean(errors.heardAboutOther)}
                  {...register('heardAboutOther')}
                />
                {errors.heardAboutOther && (
                  <p className="text-xs font-medium text-destructive">
                    {errors.heardAboutOther.message}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </div>

        <div className="space-y-1.5 pt-1">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="acceptTerms"
              checked={Boolean(acceptTerms)}
              onCheckedChange={(checked) =>
                setValue('acceptTerms', checked === true ? true : (false as never), {
                  shouldValidate: true,
                })
              }
              aria-describedby={errors.acceptTerms ? 'terms-error' : undefined}
            />
            <label htmlFor="acceptTerms" className="text-sm leading-relaxed text-muted-foreground">
              I agree to the{' '}
              <Link href="/terms" className="text-primary underline underline-offset-4">
                Terms &amp; Conditions
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-primary underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </label>
          </div>
          {errors.acceptTerms && (
            <p id="terms-error" className="text-xs font-medium text-destructive">
              {errors.acceptTerms.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          fullWidth
          size="lg"
          variant="brand"
          loading={isSubmitting}
          loadingText="Creating account…"
        >
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
