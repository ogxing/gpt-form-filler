import React from 'react';

interface SummaryListProps {
  summaries: string[];
}

const SummaryList: React.FC<SummaryListProps> = ({ summaries }) => {
  return (
    <div>
      <h2>Summaries</h2>
      <ul>
        {summaries.map((summary, index) => (
          <li key={index}>{summary}</li>
        ))}
      </ul>
    </div>
  );
};

export default SummaryList;