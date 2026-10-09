'use client';

import React, { useState } from 'react';
import Button from '../ui/Button';
import { ErrorMessage } from '../ui/Feedback';
import { Field, Input, Select } from '../ui/FormControls';
import MoreDetails from './MoreDetails';
import { statusOptions } from '@/config/options';
import type { Application, ApplicationInput, AppStatus } from '@/models/Application';
import { applicationService } from '@/services/ApplicationService';
import { errorText } from '@/utils/errorText';
import { today } from '@/utils/format';

interface ApplicationFormProps {
  initial?: Application;
  quick?: boolean;
  onSaved: (app: Application) => void;
  onCancel?: () => void;
}

const emptyForm: ApplicationInput = {
  company: '',
  role: '',
  date_applied: '',
  status: 'applied',
  job_url: '',
  salary: '',
  source: '',
  contact: '',
  notes: '',
  job_description: '',
};

const toForm = (app?: Application): ApplicationInput => {
  if (!app) return { ...emptyForm, date_applied: today() };
  const form = { ...emptyForm };
  (Object.keys(emptyForm) as (keyof ApplicationInput)[]).forEach((key) => {
    (form as Record<string, string>)[key] = (app[key] as string) ?? '';
  });
  return form;
};

/**
 * Creates or edits an application. In `quick` mode only company, role, date and status
 * are shown, with an optional toggle for the rest.
 */
const ApplicationForm: React.FC<ApplicationFormProps> = ({ initial, quick = false, onSaved, onCancel }) => {
  const [form, setForm] = useState<ApplicationInput>(() => toForm(initial));
  const [showMore, setShowMore] = useState(!quick);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setField = (field: keyof ApplicationInput, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = initial
        ? await applicationService.update(initial.id, form)
        : await applicationService.create(form);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4xl">
      {/* Quick-add fields */}
      <div className="grid gap-4xl md:grid-cols-2">
        <Field id="company" label="Company">
          <Input id="company" required autoFocus value={form.company} onChange={(e) => setField('company', e.target.value)} />
        </Field>
        <Field id="role" label="Role">
          <Input id="role" required value={form.role} onChange={(e) => setField('role', e.target.value)} />
        </Field>
        <Field id="date_applied" label="Date applied">
          <Input
            id="date_applied"
            type="date"
            required
            value={form.date_applied}
            onChange={(e) => setField('date_applied', e.target.value)}
          />
        </Field>
        <Field id="status" label="Status">
          <Select id="status" value={form.status} onChange={(e) => setField('status', e.target.value as AppStatus)}>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {quick && (
        <Button variant="link" className="self-start" onClick={() => setShowMore((s) => !s)}>
          {showMore ? 'Hide details' : 'Add more details (optional)'}
        </Button>
      )}

      {showMore && <MoreDetails form={form} setField={setField} />}

      <ErrorMessage message={error} />

      {/* Actions */}
      <div className="flex justify-end gap-lg pt-sm">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add application'}
        </Button>
      </div>
    </form>
  );
};

export default ApplicationForm;
