import type { Metadata } from 'next';
import Link from 'next/link';
import { Gap, LegalPage, List, Section } from '@/components/legal.tsx';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The rules for using Hrizzup.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <Section title="Agreeing to these terms">
        <p>
          These terms are an agreement between you and <Gap>legal entity name</Gap> ("Hrizzup",
          "we", "us") for using the Hrizzup apps and the website at hrizzup.com. By using Hrizzup
          you agree to them, and to our{' '}
          <Link href="/privacy" className="underline">
            privacy policy
          </Link>
          . If you don't agree, please don't use Hrizzup.
        </p>
      </Section>

      <Section title="Who can use Hrizzup">
        <p>
          You must be 18 or older. Use one account, with accurate details, and keep it secure. You
          are responsible for what happens in your account.
        </p>
      </Section>

      <Section title="What Hrizzup is">
        <p>
          Hrizzup shows developing news stories, and creators' takes on them. Our software finds
          news as it breaks and writes short updates, which can be incomplete or wrong, especially
          while a story is developing. Creators' takes are their own views, not ours. Nothing on
          Hrizzup is financial, legal, medical or other professional advice.
        </p>
      </Section>

      <Section title="Play money">
        <p>The prediction markets on the website use play money only:</p>
        <List>
          <li>
            Play money has no cash value. It can't be bought, sold, withdrawn, transferred to
            another account, or exchanged for money, prizes or anything else of value.
          </li>
          <li>You never stake real money, and you never win real money.</li>
          <li>A subscription never buys play money or a better position in any market.</li>
          <li>We may correct or reset play-money balances, for example after a fault or abuse.</li>
        </List>
        <p>
          The markets are for entertainment and for seeing what people expect; they are not gambling
          and not investment advice.
        </p>
      </Section>

      <Section title="Subscriptions">
        <p>
          Some features may be part of a paid subscription. The price, what it includes, how it
          renews and how to cancel are shown before you pay. Payments are handled by Google Play or
          the App Store in the apps, and by Razorpay on the website, under their terms.
        </p>
      </Section>

      <Section title="What you post">
        <p>
          You keep ownership of what you post. You give us a non-exclusive, worldwide, royalty-free
          licence to host, show, share and format it within Hrizzup and in links to it, for as long
          as it stays on Hrizzup. You must have the right to post it.
        </p>
        <p>You must not post or do anything that:</p>
        <List>
          <li>is illegal in India, or encourages anything illegal;</li>
          <li>
            is defamatory, obscene, sexually explicit, harms children, or invades someone's privacy;
          </li>
          <li>harasses, threatens or promotes hatred or violence against anyone;</li>
          <li>impersonates someone, or is deliberately false or misleading;</li>
          <li>infringes someone's copyright, trademark or other rights;</li>
          <li>threatens the unity, integrity, defence, security or sovereignty of India;</li>
          <li>
            is spam, uses bots or several accounts to manipulate stories, reactions or markets, or
            scrapes Hrizzup;
          </li>
          <li>tries to break, overload or get around Hrizzup's security.</li>
        </List>
      </Section>

      <Section title="Reports and removals">
        <p>
          You can report any post, and block any user. We review reports, and may remove content or
          suspend accounts that break these terms. We also act on valid orders from courts and
          government authorities, as the law requires. Complaints can go to our Grievance Officer,
          whose details are in the{' '}
          <Link href="/privacy" className="underline">
            privacy policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Our content">
        <p>
          Hrizzup's name, design, software and our own content belong to us. Creators' content that
          we show or link to belongs to those creators.
        </p>
      </Section>

      <Section title="No guarantees">
        <p>
          We work to keep Hrizzup accurate and available, but we provide it "as is". We don't
          guarantee that it will always be available, error-free or accurate.
        </p>
      </Section>

      <Section title="Limits on our liability">
        <p>
          As far as the law allows, we are not liable for indirect or consequential losses, or for
          decisions made on the basis of anything shown on Hrizzup. Nothing in these terms limits
          liability that the law doesn't allow us to limit.
        </p>
      </Section>

      <Section title="Ending your use">
        <p>
          You can stop using Hrizzup and delete your account at any time. We may suspend or end your
          account if you break these terms, and will tell you why unless the law prevents it.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms. We will post changes here with a new date, and tell you before
          a significant change takes effect.
        </p>
      </Section>

      <Section title="Law and disputes">
        <p>
          These terms are governed by the laws of India. Disputes are decided by the courts of{' '}
          <Gap>city</Gap>.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <Gap>contact email</Gap>
        </p>
      </Section>
    </LegalPage>
  );
}
