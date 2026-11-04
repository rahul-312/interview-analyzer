import React from 'react';
import { BookOpen, BriefcaseBusiness, ChartNoAxesColumn, NotebookPen } from 'lucide-react';

const STEPS = [
  {
    icon: BriefcaseBusiness,
    title: 'Track',
    text: 'Keep every application and interview round in one place, from saved to offer.',
  },
  {
    icon: NotebookPen,
    title: 'Debrief',
    text: 'After a round, write down the questions you were asked and how each answer went.',
  },
  {
    icon: ChartNoAxesColumn,
    title: 'Analyse',
    text: 'See what went wrong and what went well, answer by answer, with stronger answers to learn from.',
  },
  {
    icon: BookOpen,
    title: 'Prepare',
    text: 'Your recurring weak spots become a day-by-day plan for your next interview.',
  },
];

const HowItWorks: React.FC = () => {
  return (
    <section className="flex flex-col gap-12xl border-t border-light-gray py-20xl lg:py-section">
      <h2 className="max-w-modal-wide font-serif text-heading font-medium tracking-tight md:text-title">
        One loop, from application to offer
      </h2>
      <ol className="grid gap-12xl sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex flex-col gap-lg">
            <span className="flex h-16xl w-16xl items-center justify-center rounded-xl bg-primary-light text-primary">
              <Icon size={20} aria-hidden />
            </span>
            <h3 className="mt-sm font-semibold">{title}</h3>
            <p className="text-sm text-dark-gray">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default HowItWorks;
