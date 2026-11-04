import React from 'react';
import { ArrowRight } from 'lucide-react';
import AnalysisPreview from './AnalysisPreview';
import Button from '../ui/Button';

const Hero: React.FC = () => {
  return (
    <section className="grid items-center gap-16xl py-16xl lg:grid-cols-2 lg:gap-20xl lg:py-section">
      <div className="flex flex-col items-start gap-8xl">
        <h1 className="font-serif text-title font-medium tracking-tight lg:text-display">
          Find out what&apos;s costing you the offer.
        </h1>
        <p className="max-w-modal text-lg text-dark-gray">
          Track your applications, debrief every interview round, and see what keeps going wrong. Then turn your weak
          spots into a day-by-day prep plan.
        </p>
        <Button href="/register" variant="primary">
          Create a free account
          <ArrowRight size={16} aria-hidden />
        </Button>
      </div>

      <AnalysisPreview />
    </section>
  );
};

export default Hero;
