import { Client, Databases, Query } from 'node-appwrite';

const client = new Client();
client
  .setEndpoint('https://nyc.cloud.appwrite.io/v1')
  .setProject('69652130002a7bb2081f');

const databases = new Databases(client);

databases.listDocuments(
  '69f0cc60002fd9c7c29b',
  'predictions',
  [
    Query.orderDesc('release_at'),
    Query.limit(50)
  ]
)
.then(response => {
  console.log(`Total documents: ${response.total}`);
  response.documents.forEach(doc => {
    console.log(`- ID: ${doc.fixture_api_id} | ${doc.home_team_name} vs ${doc.away_team_name} | status: ${doc.release_status} | kickoff_at: ${doc.kickoff_at} | published_at: ${doc.published_at} | primary_selection: ${doc.primary_selection}`);
  });
})
.catch(err => console.error(err));
