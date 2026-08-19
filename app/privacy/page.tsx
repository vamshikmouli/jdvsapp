// Public privacy policy — required for publishing the Meta/WhatsApp app and
// generally good practice. Static, no auth. Reachable at /privacy.
export const metadata = {
  title: 'Privacy Policy — Jnana Deepika Vidhya Samsthe',
  description: 'How Jnana Deepika Vidhya Samsthe collects, uses, and protects information in its school management system.',
};

const UPDATED = '2 August 2026';
const SCHOOL = 'Jnana Deepika Vidhya Samsthe';
const CONTACT_EMAIL = 'vamshisrira1997@gmail.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <div className="mt-2 space-y-3 text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="mx-auto max-w-3xl bg-white rounded-2xl border border-slate-200 p-8 sm:p-12">
        <p className="text-sm font-medium text-purple-700">{SCHOOL}</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-400">Last updated: {UPDATED}</p>

        <p className="mt-6 text-slate-600 leading-relaxed">
          This policy explains how {SCHOOL} (“we”, “the school”) collects, uses, and protects
          information within our school management system (the “Service”), which is used by school
          staff and by parents of enrolled students. We use this information solely to run the
          school’s day-to-day administration.
        </p>

        <Section title="Information we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Student records</b> — name, class, date of birth, guardian details, admission and enrolment numbers, and related academic and fee information.</li>
            <li><b>Staff records</b> — name, designation, contact number, and attendance records.</li>
            <li><b>Contact numbers</b> — parent and staff phone numbers, used to sign in and to send school communications.</li>
            <li><b>Attendance data</b> — staff and student attendance, including biometric punch times recorded by the school’s attendance device.</li>
          </ul>
          <p>We collect this information directly from the school’s own records. The Service is not open to public sign-up.</p>
        </Section>

        <Section title="How we use information">
          <ul className="list-disc pl-5 space-y-1">
            <li>To manage student enrolment, classes, fees, marks, and attendance.</li>
            <li>To manage staff attendance and leave.</li>
            <li>To communicate with parents and staff about school matters — for example, sending staff their attendance summary or sending parents circulars and fee reminders.</li>
          </ul>
        </Section>

        <Section title="WhatsApp and messaging">
          <p>
            We may send school-related messages to staff and parents on WhatsApp using the WhatsApp
            Business Platform — for example, a staff member’s monthly attendance summary. These are
            informational messages related to the school. Recipients can ask the school office to
            stop sending them at any time, and the school can disable messaging for any individual.
          </p>
        </Section>

        <Section title="How we share information">
          <p>
            We do <b>not</b> sell personal information. Information is used within the school and is
            shared only with the technology providers that host and deliver the Service on our behalf
            (for example, our database/hosting provider and WhatsApp/Meta for message delivery), and
            where required by law.
          </p>
        </Section>

        <Section title="Data security & retention">
          <p>
            Access to the Service requires a login and is limited by role. We keep records for as
            long as the student or staff member is associated with the school and as required for the
            school’s legal and administrative needs, after which records may be archived or removed.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            Parents and staff may contact the school office to review or correct their information, to
            opt out of WhatsApp messages, or to ask questions about this policy.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            {SCHOOL}, Kyalanur.<br />
            Email: <a className="text-purple-700 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </Section>

        <p className="mt-10 text-xs text-slate-400">
          This policy may be updated from time to time; the “last updated” date above reflects the latest revision.
        </p>
      </div>
    </main>
  );
}
