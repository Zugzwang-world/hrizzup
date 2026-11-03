import type { Metadata } from 'next';
import { Gap, LegalPage, List, Section } from '@/components/legal.tsx';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How Hrizzup collects, uses and protects your personal data.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <Section title="Who we are">
        <p>
          Hrizzup is a news app built around creators, and a website with play-money prediction
          markets. It is run by <Gap>legal entity name</Gap>, <Gap>registered address</Gap>, India
          ("Hrizzup", "we", "us"). We decide how and why your personal data is used, which makes us
          the data fiduciary under India's Digital Personal Data Protection Act, 2023.
        </p>
        <p>
          This policy covers the website at hrizzup.com, the Hrizzup apps for Android and iPhone,
          and the emails we send. Questions about it go to <Gap>privacy contact email</Gap>.
        </p>
      </Section>

      <Section title="What we collect">
        <List>
          <li>
            <strong>Your account.</strong> If you sign in with Google: your name, email address,
            profile picture and Google account ID. If you sign in with a code sent by email: your
            email address. We never see your Google password.
          </li>
          <li>
            <strong>What you choose and do.</strong> The stories, topics, locations and creators you
            pick or follow, your bookmarks, likes and dislikes, the posts you write, the reports you
            make, and, on the website, your play-money trades.
          </li>
          <li>
            <strong>What creators upload.</strong> Images and videos. We remove location data from
            photos when they are uploaded.
          </li>
          <li>
            <strong>Technical data.</strong> Your IP address, device and browser type, and logs of
            requests to our servers, which we need to run the service securely and to stop abuse.
          </li>
          <li>
            <strong>Payments,</strong> if you subscribe. Payments are handled by Razorpay on the
            website and by Google Play or the App Store in the apps. We receive confirmation of your
            subscription, never your full card or bank details.
          </li>
        </List>
        <p>
          We don't collect your precise location, your contacts or your browsing on other sites, and
          we don't show advertising.
        </p>
      </Section>

      <Section title="How we use it">
        <List>
          <li>To create and run your account, and keep it signed in.</li>
          <li>
            To build your board and feed from the stories, topics and creators you choose. This is
            sorting and filtering based on your choices, not profiling.
          </li>
          <li>To send sign-in codes and the notifications you ask for.</li>
          <li>
            To keep Hrizzup safe: blocking bots (with Cloudflare Turnstile), preventing abuse and
            fraud, and acting on reports.
          </li>
          <li>To run the play-money markets and your subscription.</li>
          <li>To meet our legal obligations.</li>
        </List>
        <p>
          We use your personal data with your consent, which you give when you create an account, or
          where the law allows it without consent. You can withdraw your consent at any time by
          deleting your account; this doesn't affect anything done before you withdrew it.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use only the cookies needed to keep you signed in and to protect the site from bots. We
          don't use advertising cookies. If we ever add analytics, we will update this policy first.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          We don't sell your personal data. We share it only with the companies that run parts of
          Hrizzup for us, under contracts that limit what they may do with it:
        </p>
        <List>
          <li>Supabase: our database and sign-in service (servers in Mumbai, India).</li>
          <li>Vercel: hosts the website (servers in Mumbai, with a worldwide delivery network).</li>
          <li>Cloudflare: stores and delivers images and video, and blocks bots.</li>
          <li>Upstash: a fast temporary store that keeps the service quick (Mumbai).</li>
          <li>Resend: sends our emails.</li>
          <li>Google: if you choose to sign in with Google.</li>
          <li>
            RevenueCat, Razorpay, Google Play and Apple: for subscriptions, when you subscribe.
          </li>
        </List>
        <p>
          Posts you publish, your profile name and picture can be seen by other people using
          Hrizzup. We also share personal data when the law requires it, for example in response to
          a valid order from a court or a government authority.
        </p>
      </Section>

      <Section title="Where it is stored">
        <p>
          Your data is stored mainly in India, in Mumbai. Some of the companies above may process
          parts of it in other countries (for example, to deliver an email or a web page quickly),
          only where Indian law allows such transfers.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your account data while your account is open. When you delete your account, we
          delete or anonymise your personal data within <Gap>number</Gap> days, except what the law
          requires us to keep longer, such as security logs, which we keep for up to 180 days.
        </p>
      </Section>

      <Section title="Your rights">
        <p>You can ask us to:</p>
        <List>
          <li>tell you what personal data we hold about you and how we use it;</li>
          <li>correct, complete or update it;</li>
          <li>erase it;</li>
          <li>
            let someone you nominate exercise these rights for you if you die or are unable to.
          </li>
        </List>
        <p>
          Write to <Gap>privacy contact email</Gap>, or use the settings in the app once they are
          available. If you are not satisfied with our answer, you can complain to our Grievance
          Officer (below), and then to the Data Protection Board of India.
        </p>
      </Section>

      <Section title="Age">
        <p>
          Hrizzup is for people aged 18 and over. We don't knowingly collect data from children.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data is encrypted on its way to and from our servers. Access to it is limited to the
          people and systems that need it, and our test systems never hold real users' data. If a
          breach affects your personal data, we will tell you and the Data Protection Board of India
          as the law requires.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We will post any change on this page with a new date, and tell you in the app or by email
          before a significant change takes effect.
        </p>
      </Section>

      <Section title="Grievance Officer">
        <p>
          <Gap>name</Gap>, Grievance Officer, <Gap>email address</Gap>, <Gap>postal address</Gap>.
          We acknowledge complaints within 24 hours and resolve them within the time the law sets.
        </p>
      </Section>
    </LegalPage>
  );
}
