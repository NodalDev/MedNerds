// Internal test data only. These are neither recommendations nor published resources.
export const linkFixtures = [
  { title:'Zulu Testressource', description:'Neutrale allgemeine Testbeschreibung.', url:'https://example.org/zulu',
    specialties:['allgemein'], formats:['website'], languages:['de'], access:'free', featured:true, checked:'2026-10-06' },
  { title:'Anästhesie Testressource', description:'Neutraler Audiotest.', url:'https://example.org/anaesthesie',
    specialties:['anaesthesie'], formats:['podcast'], languages:['de'], access:'free', topics:['airway'] },
  { title:'Echo Testressource', description:'Neutraler Kurstest.', url:'https://example.org/echo', provider:'Testanbieter A',
    specialties:['echokardiographie'], formats:['kurs'], languages:['en'], access:'paid' },
  { title:'POCUS Testressource', description:'Neutraler Test für mehrere Fachgebiete.', url:'https://example.org/pocus',
    specialties:['ultraschall','notfallmedizin'], formats:['website','podcast'], languages:['de','en'], access:'mixed', topics:['pocus'] },
  { title:'Übungsfälle Testressource', description:'Beschreibungstest mit mehreren neutralen Begriffen.', url:'https://example.org/faelle', provider:'Testanbieter Beta',
    specialties:['notfallmedizin'], formats:['leitlinie','literatur'], languages:['en'], access:'free', topics:['sonderthema'] },
  { title:'EKG Testressource', description:'Neutraler Werkzeugtest.', url:'https://example.org/ekg',
    specialties:['ekg'], formats:['tool'], languages:['fr'], access:'paid' },
];
