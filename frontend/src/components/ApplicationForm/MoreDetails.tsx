'use client';

import React from 'react';
import { Field, Input, Select, TextArea } from '../ui/FormControls';
import { sourceOptions } from '@/config/options';
import type { ApplicationInput } from '@/models/Application';

interface MoreDetailsProps {
  form: ApplicationInput;
  setField: (field: keyof ApplicationInput, value: string) => void;
}

/** The optional application fields: link, source, salary, contact, JD and notes. */
const MoreDetails: React.FC<MoreDetailsProps> = ({ form, setField }) => {
  return (
    <div className="flex flex-col gap-4xl">
      <div className="grid gap-4xl md:grid-cols-2">
        <Field id="job_url" label="Job link" className="md:col-span-2">
          <Input
            id="job_url"
            type="url"
            placeholder="https://"
            value={form.job_url}
            onChange={(e) => setField('job_url', e.target.value)}
          />
        </Field>
        <Field id="source" label="Source">
          <Select id="source" value={form.source} onChange={(e) => setField('source', e.target.value)}>
            {sourceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="salary" label="Salary">
          <Input id="salary" value={form.salary} onChange={(e) => setField('salary', e.target.value)} />
        </Field>
        <Field id="contact" label="Contact" className="md:col-span-2">
          <Input
            id="contact"
            placeholder="Recruiter or referrer"
            value={form.contact}
            onChange={(e) => setField('contact', e.target.value)}
          />
        </Field>
      </div>

      <Field id="job_description" label="Job description">
        <TextArea
          id="job_description"
          rows={4}
          placeholder="Paste it here to get sharper analysis and prep plans"
          value={form.job_description}
          onChange={(e) => setField('job_description', e.target.value)}
        />
      </Field>
      <Field id="notes" label="Notes">
        <TextArea id="notes" rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
      </Field>
    </div>
  );
};

export default MoreDetails;
