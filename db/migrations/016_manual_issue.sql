-- =====================================================================
--  dTprm  Migration 016   Issuing by hand
--
--  Downloading the ZIP used to mark every supplier in it as issued, and to do
--  it with ON DUPLICATE KEY UPDATE - so a second download reset issued_time to
--  today and dragged rows that had reached 'emailed' or 'reminded' back to
--  'zipped'. The record of how long a supplier had actually been holding the
--  questionnaire was lost, which is the number that decides whether chasing
--  them is fair.
--
--  A download is now just a download. Issuing is something a person states,
--  and there are three honest ways it happens:
--
--    email   dTprm sent it, and knows the address and the moment
--    zip     the pack went to the client, who is forwarding it
--    manual  somebody took a workbook out of the ZIP and sent it themselves
--
--  'manual' is the new one. Without it the only way to record "I emailed this
--  supplier from my own mailbox" was to claim dTprm had sent it, which would
--  put an address and a delivery in the record that never happened.
-- =====================================================================

USE dtprm;

ALTER TABLE distribution
  MODIFY COLUMN channel ENUM('zip','email','manual') NOT NULL;
