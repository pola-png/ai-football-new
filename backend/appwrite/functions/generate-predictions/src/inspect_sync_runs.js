import { Client, Databases, Query } from 'node-appwrite';

const client = new Client();
client
  .setEndpoint('https://nyc.cloud.appwrite.io/v1')
  .setProject('69652130002a7bb2081f');

const databases = new Databases(client);

databases.listDocuments(
  '69f0cc60002fd9c7c29b',
  'sync_runs',
  [
    Query.orderDesc('started_at'),
    Query.limit(10)
  ]
)
.then(response => {
  console.log(`Total sync runs: ${response.total}`);
  response.documents.forEach(doc => {
    console.log(`- Job: ${doc.job_name} | RunID: ${doc.sync_run_id} | Status: ${doc.status} | StartedAt: ${doc.started_at} | Saved: ${doc.items_saved} | Msg: ${doc.message}`);
  });
})
.catch(err => console.error(err));
