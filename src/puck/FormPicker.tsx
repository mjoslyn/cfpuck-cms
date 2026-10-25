// Form selector for the Form block: lists the forms built in /admin/forms/.
import { useEffect, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { Row, inputClass } from './fields';

export function FormPicker({ value, onChange }: { value: number | undefined; onChange: (id: number | undefined) => void }) {
  const [forms, setForms] = useState<{ id: number; title: string; is_active: boolean }[] | null>(null);
  useEffect(() => {
    browserClient()
      .from('forms')
      .select('id, title, is_active')
      .order('title')
      .then(({ data }) => setForms(data ?? []));
  }, []);
  return (
    <Row title="Form">
      <select className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
        <option value="">{forms ? 'Choose a form' : 'Loading...'}</option>
        {forms?.map((f) => (
          <option key={f.id} value={f.id}>
            {f.title}
            {f.is_active ? '' : ' (inactive)'}
          </option>
        ))}
      </select>
      <a href="/admin/forms/" target="_blank" className="mt-1 inline-block text-xs text-admin-muted underline hover:text-admin-accent">
        Manage forms
      </a>
    </Row>
  );
}
