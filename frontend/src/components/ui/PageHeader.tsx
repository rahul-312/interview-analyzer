import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2xl">
      <div>
        <h1 className="font-serif text-heading font-medium tracking-tight md:text-title">{title}</h1>
        {subtitle && <p className="mt-lg text-medium-gray">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-lg">{actions}</div>}
    </div>
  );
};

export default PageHeader;
