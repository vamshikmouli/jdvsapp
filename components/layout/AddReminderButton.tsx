'use client';

import React, { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ReminderModal } from '@/components/ReminderModal';

// Global "add a reminder" action for the top bar — create a follow-up from anywhere.
export function AddReminderButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Add a reminder" aria-label="Add a reminder"
        className="p-2 rounded-md text-slate-500 hover:text-purple-600 hover:bg-slate-100 transition-colors">
        <Icon name="BellPlus" size={20} />
      </button>
      <ReminderModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
