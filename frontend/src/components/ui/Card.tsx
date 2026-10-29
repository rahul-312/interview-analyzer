import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => {
  return (
    <div className={`glass rounded-2xl p-6xl ${className}`} {...props}>
      {children}
    </div>
  );
};

export default Card;
