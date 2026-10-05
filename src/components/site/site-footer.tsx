import Link from 'next/link';

import { Logo } from '@/components/site/logo';
import { SocialLinks } from '@/components/site/socials';
import { publicEnv } from '@/lib/env';

/**
 * Public footer. Link groups are static because they mirror the route
 * structure; editorial content (exam list, policies) is CMS-driven elsewhere.
 */
const FOOTER_SECTIONS = [
  {
    title: 'Platform',
    links: [
      { href: '/courses', label: 'All courses' },
      { href: '/pyq', label: 'Previous year papers' },
      { href: '/chapterwise', label: 'Chapterwise practice' },
      { href: '/test-series', label: 'Test series' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/practice', label: 'Quiz' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About us' },
      { href: '/success-stories', label: 'Success stories' },
      { href: '/blog', label: 'Blog' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/faq', label: 'FAQ' },
      { href: '/support', label: 'Help centre' },
      { href: '/contact', label: 'Get in touch' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms & conditions' },
      { href: '/refund-policy', label: 'Refund policy' },
    ],
  },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
              A preparation platform built around one idea: every attempt should tell you exactly
              what to study next. Mock tests, practice and analytics that stay honest about where
              you stand.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {FOOTER_SECTIONS.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {section.title}
                </h3>
                <ul className="mt-3.5 space-y-2.5">
                  {section.links.map((link) => (
                    <li key={`${section.title}-${link.href}-${link.label}`}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border pt-7 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            &copy; {year} {publicEnv.appName}. All rights reserved.
          </p>

          <SocialLinks />

          <p className="text-sm text-muted-foreground">
            A Stronger You for a Better Karnataka
          </p>
        </div>
      </div>
    </footer>
  );
}
