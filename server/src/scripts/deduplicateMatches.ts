import { getClient } from '../config/database';

const DRY_RUN = process.argv.includes('--dry-run');

// The newer (higher ID) of each duplicate pair, identified by the sanity check.
// These are matches ingested under a different name casing than the original.
const DUPLICATE_IDS = [
  195, // CRUZEIRO vs VITORIA SALVADOR (dup of 157: Cruzeiro vs Vitoria)
  196, // SANTOS vs REMO (dup of 158: Santos FC vs Remo)
  230, // PALMEIRAS vs GREMIO (dup of 168: Palmeiras vs Gremio)
  225, // COVENTRY vs DERBY COUNTY (dup of 166: Coventry City vs Derby County)
  216, // REIMS vs BOULOGNE (dup of 182: Reims vs Boulogne)
  218, // SHANDONG TAISHAN vs DALIAN YINGBO (dup of 183: Shandong Taishan vs Dalian Yingbo FC)
  359, // SLAVIA MOZYR vs ARSENAL DZERZ. (dup of 294: Slavia Mozyr vs Arsenal Dzerzhinsk)
  352, // MIDDLESBROUGH vs PORTSMOUTH (dup of 273: Middlesbrough vs Portsmouth)
];

async function main() {
  console.log(`Deduplication (${DRY_RUN ? 'DRY-RUN' : 'REAL'} mode): removing ${DUPLICATE_IDS.length} duplicate matches`);
  console.log(`IDs to delete: ${DUPLICATE_IDS.join(', ')}`);

  if (DRY_RUN) {
    console.log('DRY-RUN: no changes made.');
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    // ON DELETE CASCADE handles predictions + odds_history
    const del = await client.query('DELETE FROM matches WHERE id = ANY($1)', [DUPLICATE_IDS]);
    console.log(`Deleted ${del.rowCount} duplicate matches.`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log('Done.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
