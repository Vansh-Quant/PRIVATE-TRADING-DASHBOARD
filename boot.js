(function(){
  try{init();}catch(e){console.error('TradeLedger boot failed',e);}
  try{if(document.getElementById('page-simulator')?.classList.contains('active')){loadSimChart();connectLiveMarket();fetchLivePaperQuote();}}catch(e){console.error('Paper terminal boot failed',e);}
})();
