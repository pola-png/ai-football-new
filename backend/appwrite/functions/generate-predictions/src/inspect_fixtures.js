import { Client, Databases, Query } from 'node-appwrite';

const client = new Client();
client
  .setEndpoint('https://nyc.cloud.appwrite.io/v1')
  .setProject('69652130002a7bb2081f');

const databases = new Databases(client);

databases.listDocuments(
  '69f0cc60002fd9c7c29b',
  'fixtures',
  [
    Query.limit(300)
  ]
)
.then(response => {
  console.log(`Total fixtures found: ${response.total}`);
  const dateCounts = {};
  response.documents.forEach(doc => {
    const kickoff = doc.kickoff_at;
    if (kickoff) {
      const date = kickoff.substring(0, 10);
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    }
  });
  console.log("Fixtures count by date:", dateCounts);
})
.catch(err => console.error(err));
