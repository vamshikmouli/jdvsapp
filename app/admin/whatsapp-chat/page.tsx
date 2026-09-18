'use client';

import React from 'react';
import { PageHeader } from '@/components/Primitives';
import WhatsAppInbox from '@/components/WhatsAppInbox';

export default function WhatsAppChatPage() {
  return (
    <>
      <PageHeader eyebrow="Administration" title="WhatsApp" meta="Chat with parents — their replies land here; reply within WhatsApp's 24-hour window." />
      <div className="mt-6">
        <WhatsAppInbox />
      </div>
    </>
  );
}
