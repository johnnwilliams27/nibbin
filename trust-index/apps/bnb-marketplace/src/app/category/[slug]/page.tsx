import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_BY_PATH } from '@/lib/categories';
import { agentsInCategory } from '@/lib/data';
import { AgentExplorer } from '@/components/AgentExplorer';

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.path }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const meta = CATEGORY_BY_PATH.get(slug);
  return meta ? { title: `${meta.name} agents`, description: meta.blurb } : {};
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = CATEGORY_BY_PATH.get(slug);
  if (!meta) notFound();
  const all = agentsInCategory(meta.slug);
  const agents = all.filter((a) => !a.is_reference_agent);
  const reference = all.filter((a) => a.is_reference_agent);

  return (
    <div className="page-wrap py-9">
      <nav aria-label="Breadcrumb" className="text-[12px] text-[var(--fg-muted)]">
        <Link href="/" className="hover:text-[var(--fg)]">Home</Link><span className="mx-2">/</span><Link href="/compare">Find agents</Link><span className="mx-2">/</span>{meta.name}
      </nav>
      <header className="mt-7">
        <div>
          <h1 className="text-[clamp(30px,4vw,46px)] leading-tight">{meta.name} agents</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-[var(--fg-muted)]">{meta.blurb}</p>
          <p className="mt-2 max-w-2xl text-[13px] text-[var(--fg-muted)]">Grouped by operator descriptions. A category match does not establish that an agent can complete the task.</p>
        </div>
      </header>
      <nav aria-label="Agent categories" className="my-8 flex gap-2 overflow-x-auto pb-2">
        {CATEGORIES.map((category) => (
          <Link key={category.slug} href={`/category/${category.path}`} aria-current={category.slug === meta.slug ? 'page' : undefined}
            className="shrink-0 rounded-lg border px-4 py-2.5 text-[13px]"
            style={{ borderColor: category.slug === meta.slug ? meta.accent : 'var(--border)', background: category.slug === meta.slug ? meta.accentTint : undefined }}>
            {category.name}
          </Link>
        ))}
      </nav>
      <AgentExplorer agents={agents} reference={reference} />
      <details className="mt-6 text-[14px] text-[var(--fg-muted)]"><summary className="cursor-pointer">Before you connect</summary><p className="mt-3">{meta.buyerQuestion}</p><p className="mt-2">Category matches reflect operator descriptions, not completed tasks or endorsements. <Link href="/methodology#selection" className="underline underline-offset-4">How agents are selected</Link></p></details>
    </div>
  );
}
