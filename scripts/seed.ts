/**
 * Seed talent, maneuver, supernatural, equipment, and special-ability catalogs (idempotent).
 *   tsx scripts/seed.ts     (or: npm run db:seed)
 */

import 'dotenv/config';
import { seedDatabase } from '../db/operations';
import { closeDb } from '../db';
import { seedSupernaturalCatalogs } from './catalogSeed';
import { seedEquipmentCatalog } from './equipmentSeed';
import { seedSpecialAbilityCatalog } from './specialAbilitySeed';

(async () => {
    try {
        const result = await seedDatabase();
        const supernatural = await seedSupernaturalCatalogs();
        const equipment = await seedEquipmentCatalog();
        const specialAbilities = await seedSpecialAbilityCatalog();
        console.log('seed result:', JSON.stringify({ ...result, supernatural, equipment, specialAbilities }, null, 2));
    } catch (err) {
        console.error('seed failed:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
    } finally {
        await closeDb();
    }
})();
