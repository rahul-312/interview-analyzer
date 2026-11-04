'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Logo from '../Logo';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage } from '../ui/Feedback';
import { Field, Input } from '../ui/FormControls';
import { useAuth } from '@/context/AuthContext';
import { errorText } from '@/utils/errorText';

interface AuthFormProps {
  mode: 'login' | 'register';
}

const emptyForm = { username: '', password: '', email: '', first_name: '' };

/** One form for both logging in and creating an account. */
const AuthForm: React.FC<AuthFormProps> = ({ mode }) => {
  const { user, ready, login, register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';
  // Someone picking a plan goes back to pricing. Only this page: `next` comes from the address bar.
  const toPricing = router.query.next === '/pricing';
  const plan = typeof router.query.plan === 'string' && /^[a-z_]+$/.test(router.query.plan) ? router.query.plan : undefined;
  const next = !toPricing ? '/applications' : plan ? `/pricing?plan=${plan}` : '/pricing';

  // Already logged in: skip the form
  useEffect(() => {
    if (ready && user) router.replace(next);
  }, [ready, user, next, router]);

  const setField = (field: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isLogin) await login(form.username, form.password);
      else await register(form);
      router.replace(next);
    } catch (err) {
      setError(isLogin ? 'Wrong username or password.' : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8xl px-4xl">
      <Logo href="/" />
      <Card className="w-full max-w-auth-card">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4xl">
          {/* Heading */}
          <div>
            <h1 className="text-xl font-semibold">{isLogin ? 'Log in' : 'Create your account'}</h1>
            <p className="mt-sm text-sm text-medium-gray">Track applications, debrief interviews, and fix your weak spots.</p>
          </div>

          <Field id="username" label="Username">
            <Input id="username" autoComplete="username" required value={form.username} onChange={setField('username')} />
          </Field>
          {!isLogin && (
            <>
              <Field id="first_name" label="First name (optional)">
                <Input id="first_name" value={form.first_name} onChange={setField('first_name')} />
              </Field>
              <Field id="email" label="Email (optional)">
                <Input id="email" type="email" value={form.email} onChange={setField('email')} />
              </Field>
            </>
          )}
          <Field id="password" label="Password">
            <Input
              id="password"
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              value={form.password}
              onChange={setField('password')}
            />
          </Field>

          <ErrorMessage message={error} />

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'}
          </Button>

          <p className="text-center text-sm text-medium-gray">
            {isLogin ? 'New here? ' : 'Already have an account? '}
            <Link href={{ pathname: isLogin ? '/register' : '/login', query: toPricing ? { next: '/pricing', ...(plan && { plan }) } : {} }} className="font-medium text-primary hover:underline">
              {isLogin ? 'Create an account' : 'Log in'}
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
};

export default AuthForm;
