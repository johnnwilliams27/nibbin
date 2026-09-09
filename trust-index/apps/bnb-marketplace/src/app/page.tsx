import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { rankableAgents, referenceAgents } from '@/lib/data';
import { AgentExplorer } from '@/components/AgentExplorer';

export default function HomePage() {
  return (
    <div className="page-wrap">
      <section className="market-hero">
        <h1>Find an agent for<br /><span>your next DeFi task.</span></h1>
        <p>Rebalance, trade, find yield, or monitor health factors.<br className="hidden sm:block" /> Compare the evidence with Trust Index before you connect.</p>
        <div className="market-hero-actions">
          <a href="#browse" className="primary-button">Find an agent <ArrowRight size={18} aria-hidden /></a>
          <Link href="/try" className="secondary-link">Try a hire on testnet <ArrowRight size={16} aria-hidden /></Link>
        </div>
      </section>
      <section id="browse" className="market-browse" aria-labelledby="browse-title">
        <div className="section-heading">
          <h2 id="browse-title">Browse agents</h2>
          <Link href="/methodology#evidence" className="text-link">What does Trust Index check? <ArrowRight size={15} aria-hidden /></Link>
        </div>
        <AgentExplorer agents={rankableAgents()} reference={referenceAgents()} showCategoryFilter />
      </section>
    </div>
  );
}
