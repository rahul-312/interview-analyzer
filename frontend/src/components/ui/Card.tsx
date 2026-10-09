import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => {
  return (
    <div className={`rounded-xl border border-light-gray bg-white p-6xl shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
};

export default Card;
