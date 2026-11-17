import React from 'react';
import LegalPage, { Email, List, Section } from './LegalPage';
import { legal } from '@/config/legal';

const Privacy: React.FC = () => (
  <LegalPage
    title="Privacy Policy"
    intro={`What ${legal.service} collects, why, who it's shared with, and the choices you have.`}
  >
    <Section title="1. Who we are">
      <p>
        {legal.service} is run by {legal.operator}, {legal.address}. We’re responsible for the personal data described
        here. For anything about your data, email <Email />.
      </p>
    </Section>

    <Section title="2. What we collect">
      <List>
        <li>
          <strong className="font-medium text-ink">Account details:</strong> your username, email address and first
          name. Your password is stored only as a secure hash.
        </li>
        <li>
          <strong className="font-medium text-ink">What you add:</strong> job applications, interview rounds, debriefs,
          and the analyses and prep plans made from them.
        </li>
        <li>
          <strong className="font-medium text-ink">Voice recordings:</strong> when you fill in a debrief by voice, the
          recording is sent to our AI provider to write the draft, then discarded. We don’t keep the audio.
        </li>
        <li>
          <strong className="font-medium text-ink">Browser extension:</strong> the details of jobs you choose to save
          (title, company, description, link), and the links of jobs on a page you visit, so it can mark the ones
          you’ve already saved. It doesn’t run on email, banking, payment or password-manager sites.
        </li>
        <li>
          <strong className="font-medium text-ink">Payments:</strong> Razorpay handles payments. We receive your
          subscription and payment status, amounts, dates, the payment method type and the card network, bank or
          wallet name, but never your full card number, UPI ID or bank account details.
        </li>
        <li>
          <strong className="font-medium text-ink">Technical data:</strong> your IP address (to limit sign-ups and
          prevent abuse), your time zone (to show dates in your day), and standard server logs.
        </li>
      </List>
      <p>
        We keep your login in your browser’s local storage. We don’t use advertising or analytics cookies, and we don’t
        sell your data.
      </p>
    </Section>

    <Section title="3. How we use it">
      <List>
        <li>to run the service: store your data, generate analyses and prep plans, and show your usage;</li>
        <li>to handle subscriptions, payments and refunds;</li>
        <li>to keep the service secure and prevent abuse;</li>
        <li>to answer your messages and send account and billing emails;</li>
        <li>on the Free plan only, to improve our AI using your debriefs (see below).</li>
      </List>
    </Section>

    <Section title="4. AI processing and training">
      <p>
        To analyse a round, build a prep plan or write up a voice debrief, the relevant debriefs or recording are sent
        to Google’s Gemini models, through the Gemini API or Google Cloud’s Vertex AI. Google processes them to return a result.
      </p>
      <p>
        On the Free plan, we may use Gemini’s free tier. There, Google may use what’s sent to improve its products,
        and people at Google may review it. The app says so before you send anything, so leave out anything you
        wouldn’t want shared. Pro and Pro Plus never use Gemini’s free tier.
      </p>
      <p>
        On the Free plan, your debriefs may also be used to train and improve our AI, and the app says so where you
        write them. On Pro and Pro Plus, your debriefs are never used for training. That includes the ones you wrote
        on Free, from the moment you upgrade, though anything already used before then can’t be taken back. Moving
        back to Free doesn’t change that for debriefs written on a paid plan; only new ones may be used.
      </p>
    </Section>

    <Section title="5. Who we share it with">
      <p>Only with service providers that help us run the service, under their own privacy and security terms:</p>
      <List>
        <li>Google (Gemini AI models, through the Gemini API or Vertex AI, and Gmail, which sends our emails)</li>
        <li>Razorpay (payments and subscriptions)</li>
        <li>Neon (database), Render (application servers), Vercel (website) and Upstash (caching and rate limiting)</li>
      </List>
      <p>
        We may also disclose data if the law requires it. These providers may store and process data outside India,
        including in Singapore and the United States.
      </p>
    </Section>

    <Section title="6. How long we keep it">
      <p>
        We keep your account data for as long as your account exists. When you ask us to delete your account, we
        delete your data within 30 days, except payment and invoice records we must keep under tax and accounting law.
      </p>
    </Section>

    <Section title="7. Your rights">
      <p>
        You can ask to access, correct or delete your personal data, or withdraw your consent, including under India’s
        Digital Personal Data Protection Act, 2023. Email <Email /> from your account’s email address and we’ll respond
        within 30 days. You can also delete applications, rounds and prep plans yourself in the app.
      </p>
    </Section>

    <Section title="8. Security">
      <p>
        Data is sent over HTTPS, passwords are hashed, and access to the database is restricted. No system is perfectly
        secure; if a breach affects your data, we’ll tell you as the law requires.
      </p>
    </Section>

    <Section title="9. Age">
      <p>
        The service is for people aged {legal.minimumAge} and over. We don’t knowingly collect data from anyone younger.
      </p>
    </Section>

    <Section title="10. Changes and grievances">
      <p>
        We’ll post any changes here and update the date at the top; for significant changes we’ll tell you by email or
        in the app. For questions or complaints about your data, contact our grievance contact at <Email /> or{' '}
        <a href={legal.phoneHref} className="font-medium text-primary hover:underline">
          {legal.phone}
        </a>
        .
      </p>
    </Section>
  </LegalPage>
);

export default Privacy;
