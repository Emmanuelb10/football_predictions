export default function Glossary() {
  const terms = [
    { term: 'Tip', def: 'Predicted outcome: 1 = Home Win, X = Draw, 2 = Away Win.' },
    { term: 'Prob', def: 'The AI\'s estimated probability (%) of the tipped outcome winning.' },
    { term: 'Odds (H/D/A)', def: 'Decimal betting odds for Home / Draw / Away from bookmakers. Lower odds = more likely outcome. Green highlight = value range (1.50-1.99).' },
    { term: 'EV (Expected Value)', def: 'EV = (probability x odds) - 1. Positive EV means the bet is profitable long-term. Higher is better.' },
    { term: 'Value Bet', def: 'A match where probability is 70%+ AND the tipped odds are between 1.50-1.99. The AI believes the true chance of winning is higher than what the odds imply.' },
    { term: 'POTD (Pick of the Day)', def: 'The single best value bet each day, selected by a composite score combining EV, league reliability, team consistency, and Poisson model agreement.' },
    { term: 'W / L / P', def: 'Wins / Losses / Pending. W = tip was correct, L = tip was wrong, P = match not yet finished.' },
    { term: 'Units (u)', def: 'Standard bet sizing. 1 unit = your base stake (e.g. $10). Profit/loss shown in units for consistency. A win at 1.80 odds = +0.80u profit. A loss = -1.00u.' },
    { term: 'Streak', def: 'Consecutive wins (W) or losses (L) across recent settled value bets. e.g. W5 = five wins in a row.' },
    { term: 'Hit Ratio', def: 'Percentage of correct predictions out of total settled picks. e.g. 7 wins out of 10 = 70% hit ratio.' },
    { term: 'ROI (Return on Investment)', def: 'Total profit divided by total amount staked, as a percentage. Positive ROI = profitable system.' },
    { term: 'Brier Score', def: 'Measures prediction accuracy on a 0-1 scale. 0 = perfect predictions, lower is better. Penalizes overconfident wrong predictions.' },
    { term: 'Log Loss', def: 'Cross-entropy metric that penalizes confident wrong predictions more heavily than uncertain ones. Lower is better.' },
    { term: 'Confidence Tiers', def: 'Matches grouped by win probability: HIGH (90%+, gold), STRONG (80-89%, green), VALUE (70-79%, blue).' },
    { term: 'Accumulator (Acca)', def: 'A multi-bet combining 2-4 picks. ALL legs must win for the acca to pay out. Combined odds = individual odds multiplied together.' },
    { term: '2-Fold / 3-Fold / 4-Fold', def: 'The number of legs in an accumulator. A 3-fold combines 3 picks. Higher folds = bigger payout but lower chance of winning.' },
    { term: 'Profit/Loss Banner', def: '"Today: 3W - 1L - 2P" means 3 wins, 1 loss, 2 matches still pending. "+1.40 units" is the net profit for the day.' },
    { term: 'Result Column', def: 'Shows the final score (e.g. 2-1) with a green checkmark (\u2713) if the tip was correct, or red cross (\u2717) if wrong.' },
  ];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        &#128218; Glossary
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        {terms.map((t) => (
          <div key={t.term} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--accent-blue)' }}>
              {t.term}
            </span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {t.def}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
