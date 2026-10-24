// Synthetic bibliographic data, exclusively for local regression fixtures. Never editorial sources.
export const testReferences = Array.from({length:30},(_,index)=>({
  id:`testquelle-${index+1}`,type:'book',title:`Testbuch ${index+1} – ä, ö & <img src=x onerror="window.__referenceXss=1">`,
  authors:[{family:'Müller',given:'Anna Maria'}],year:2024,publisher:'Testverlag',
  ...(index===0?{doi:'10.1234/mednerds-test',url:'https://example.test/verlag'}:{}),
}));
export const testBook={id:'buch',type:'book',title:'Testbuch',authors:[{family:'Müller',given:'Anna'}],year:2024,publisher:'Testverlag'};
