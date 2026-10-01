function toggleGirviViewMode(btn){
  GIRVI_VIEW_MODE = (GIRVI_VIEW_MODE==='customer') ? 'list' : 'customer';
  try{ localStorage.setItem('jewelos_girvi_view_mode', GIRVI_VIEW_MODE); }catch(e){}
  if(btn) btn.classList.toggle('active', GIRVI_VIEW_MODE==='customer');
  resetGirviPage();
}

// ── HELPER: format time from ISO string ─────────────────────────────
// ── ACTIVE CHIP TOGGLE ──────────────────────────────────────────────
function toggleGirviChip(key, btn){
  _girviChips[key] = !_girviChips[key];
  btn.classList.toggle('active', !!_girviChips[key]);
  resetGirviPage();
}

// ── EXECUTIVE DASHBOARD RENDERER ────────────────────────────────────
function renderGirviExecDash(){
  var el = document.getElementById('girvi-exec-dash');
  if(!el) return;
  var girvi = (S.girvi||[]).filter(function(g){return !g._deleted;});
  var active   = girvi.filter(function(g){ return g.status!=='closed'; });
  // Includes 'defaulted' so this matches the Girvi Portfolio strip's
  // Overdue count (07-settings-plans.js renderGirviCP) — a defaulted loan
  // is strictly worse than overdue, not a separate bucket that should make
  // this card say "All clear" while the other screen says otherwise.
  var overdue  = girvi.filter(function(g){ return g.status==='overdue'||g.status==='atrisk'||g.status==='defaulted'; });
  var totalPrincipal = active.reduce(function(s,g){ return s+(parseFloat(g.principal)||0); },0);
  var totalInterest  = active.reduce(function(s,g){ return s+girviInterestAccrued(g); },0);
  var totalExpected  = active.reduce(function(s,g){ return s+girviOutstanding(g); },0);
  var totalPaid      = girvi.reduce(function(s,g){ return s+girviTotalPaid(g); },0);
  var dueThisMonth   = girvi.filter(function(g){
    if(g.status==='closed') return false;
    var di = girviDaysInfo(g);
    return di.daysLeft>=0 && di.daysLeft<=30;
  });
  var fmt = function(n){ return '\u20b9'+(Math.round(n)||0).toLocaleString('en-IN'); };

  var cards = [
    { label:'Outstanding',    val: fmt(Math.round(totalExpected)), sub: active.length+' active loans', accent:'linear-gradient(90deg,#c9a84c,#e2c063)', valColor:'var(--ink)' },
    { label:'Interest Earned',val: fmt(Math.round(totalInterest)), sub: 'Accrued today',                accent:'linear-gradient(90deg,#1c6040,#22c55e)', valColor:'var(--success)' },
    { label:'Overdue',        val: overdue.length,                 sub: overdue.length?'Need follow-up':'All clear \u2713', accent:'linear-gradient(90deg,'+(overdue.length?'#a8312a,#ef4444':'#1c6040,#22c55e')+')', valColor: overdue.length?'var(--danger)':'var(--success)' },
    { label:'Due This Month', val: dueThisMonth.length,           sub: fmt(dueThisMonth.reduce(function(s,g){ return s+girviOutstanding(g); },0))+' expected', accent:'linear-gradient(90deg,#8a4e0c,#f59e0b)', valColor:'var(--warning)' }
  ];

  el.innerHTML = cards.map(function(c){
    return '<div class="ged-card" style="--ged-accent:'+c.accent+';">'+
      '<div class="ged-label">'+c.label+'</div>'+
      '<div class="ged-val" style="color:'+c.valColor+';">'+c.val+'</div>'+
      '<div class="ged-sub">'+c.sub+'</div>'+
    '</div>';
  }).join('');

  // Overdue banner
  var ob = document.getElementById('girvi-overdue-banner');
  if(ob){
    if(overdue.length){
      var top5 = overdue.slice().sort(function(a,b){ return girviOutstanding(b)-girviOutstanding(a); }).slice(0,5);
      ob.className = 'girvi-overdue-banner';
      ob.innerHTML =
        '<div class="girvi-overdue-title">\ud83d\udd34 '+overdue.length+' Overdue Loans \u2014 Immediate Action Required</div>'+
        top5.map(function(g){
          var di = girviDaysInfo(g);
          var stage = di.overdue>90?'stage-auction':di.overdue>30?'stage-crit':'stage-warn';
          var stageLabel = di.overdue>90?'Auction Risk':di.overdue>30?'Critical':'Warning';
          return '<div class="girvi-overdue-row">'+
            '<span style="font-weight:700;">'+escHtml(g.customer)+'</span>'+
            '<span style="font-size:11px;color:var(--text3);">'+g.grvNo+' \u00b7 '+di.overdue+'d overdue</span>'+
            '<span class="girvi-auction-stage '+stage+'">'+stageLabel+'</span>'+
            '<span style="font-weight:700;color:var(--danger);">\u20b9'+Math.round(girviOutstanding(g)).toLocaleString('en-IN')+'</span>'+
            '<button style="padding:3px 9px;border-radius:8px;border:none;background:var(--danger);color:#fff;font-size:11px;font-weight:700;cursor:pointer;" onclick="openGirviLedger(\''+g.id+'\')">Collect</button>'+
          '</div>';
        }).join('');
    } else {
      ob.innerHTML = '';
    }
  }
}

// ── GIRVI GROUPED-BY-CUSTOMER VIEW (Feature 1) ─────────────────────────
// Groups every Girvi entry under its linked customer account, showing
// totals (active count, loan amount, interest, outstanding, items) per
// customer with active/closed/redeemed entries listed underneath.
function renderGirviByCustomer(search, filter, metalFilter){
  var listEl = document.getElementById('girvi-list');
  if(!listEl) return;
  var girvi = (S.girvi||[]).filter(function(g){return !g._deleted;});

  // Group by customerId (fall back to a synthetic key for unlinked legacy rows)
  var groups = {};
  girvi.forEach(function(g){
    var key = g.customerId || ('legacy_'+normName(g.customer)+'_'+normPhone(g.phone));
    if(!groups[key]) groups[key] = { custId:g.customerId||null, customer:g.customer, phone:g.phone, entries:[] };
    groups[key].entries.push(g);
  });

  var rows = Object.keys(groups).map(function(k){ return groups[k]; });

  // Apply search/filter at the group level (matches if ANY entry matches)
  rows = rows.filter(function(grp){
    var ms = !search || grp.entries.some(function(g){
      return (g.customer||'').toLowerCase().indexOf(search)>-1 ||
        (g.phone||'').indexOf(search)>-1 ||
        (g.grvNo||'').toLowerCase().indexOf(search)>-1 ||
        ((g.item&&g.item.desc)||'').toLowerCase().indexOf(search)>-1 ||
        (g.items||[]).some(function(it){ return (it.desc||'').toLowerCase().indexOf(search)>-1; });
    });
    var sf = filter==='all' || grp.entries.some(function(g){ return g.status===filter; });
    var mf = metalFilter==='all' || grp.entries.some(function(g){
      var its = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
      return its.some(function(it){ return (it&&it.metal)===metalFilter; });
    });
    return ms&&sf&&mf;
  });

  if(!rows.length){
    listEl.innerHTML='<div style="text-align:center;padding:3rem 1rem;color:var(--text3);">'+
      '<div style="font-size:28px;margin-bottom:8px;">🔍</div><div>No customers found</div></div>';
    var cl0=document.getElementById('girvi-count-label'); if(cl0) cl0.textContent='';
    return;
  }

  rows.forEach(function(grp){
    var active = grp.entries.filter(function(g){return g.status!=='closed';});
    var closed = grp.entries.filter(function(g){return g.status==='closed';});
    grp.totalLoan = grp.entries.reduce(function(s,g){return s+(parseFloat(g.principal)||0);},0);
    grp.totalInterest = grp.entries.filter(function(g){return g.status!=='closed';}).reduce(function(s,g){return s+girviInterestAccrued(g);},0);
    grp.totalOutstanding = active.reduce(function(s,g){return s+girviOutstanding(g);},0);
    grp.totalItems = grp.entries.reduce(function(s,g){ var its=Array.isArray(g.items)&&g.items.length?g.items:(g.item?[g.item]:[]); return s+its.reduce(function(a,it){return a+(parseInt(it.qty)||1);},0); },0);
    grp.activeCount = active.length;
    grp.closedCount = closed.length;
  });

  rows.sort(function(a,b){ return b.totalOutstanding - a.totalOutstanding; });

  listEl.innerHTML = rows.map(function(grp){
    var entriesHtml = grp.entries
      .slice().sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); })
      .map(function(g){
        var its = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
        var itemDesc = its.length===1 ? (its[0].desc||its[0].type||'Item') : (its.length+' items');
        var statusBadge = girviStatusBadge(g.status);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:12px;background:rgba(0,0,0,0.02);margin-bottom:6px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background=\'rgba(201,168,76,.07)\'" onmouseout="this.style.background=\'rgba(0,0,0,0.02)\'" onclick="event.stopPropagation();openGirviDetail(\''+g.id+'\')">'+
          '<div><span style="font-weight:700;font-size:12px;">'+g.grvNo+'</span> '+statusBadge+
          '<div style="font-size:11px;color:var(--text3);margin-top:2px;">'+escHtml(itemDesc)+' &bull; '+fmtDate(g.startDate)+'</div></div>'+
          '<div style="text-align:right;"><div style="font-weight:700;font-size:13px;">\u20b9'+Math.round(g.status==='closed'?g.principal:girviOutstanding(g)).toLocaleString('en-IN')+'</div></div>'+
        '</div>';
      }).join('');

    var custIdAttr = grp.custId || '';
    return '<div class="girvi-card" style="cursor:default;border-radius:16px;border-color:rgba(201,168,76,.14);">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;padding:14px 16px 0;">'+
        '<div>'+
          '<div style="font-weight:700;font-size:15px;">👤 '+escHtml(grp.customer||'Unknown')+'</div>'+
          (grp.phone?'<div style="font-size:12px;color:var(--text3);margin-top:2px;">📞 '+escHtml(grp.phone)+'</div>':'')+
        '</div>'+
        '<div style="text-align:right;">'+
          '<div style="font-size:11px;color:var(--text3);">'+grp.activeCount+' active &bull; '+grp.closedCount+' closed &bull; '+grp.totalItems+' items</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin:0 16px 12px;padding:10px 0;border-top:0.5px solid rgba(201,168,76,.14);border-bottom:0.5px solid rgba(201,168,76,.14);">'+
        '<div><div style="font-size:10px;color:var(--text3);">Total Loan</div><div style="font-weight:700;">\u20b9'+Math.round(grp.totalLoan).toLocaleString('en-IN')+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Interest Due</div><div style="font-weight:700;color:#f59e0b;">\u20b9'+Math.round(grp.totalInterest).toLocaleString('en-IN')+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Outstanding</div><div style="font-weight:700;color:var(--danger);">\u20b9'+Math.round(grp.totalOutstanding).toLocaleString('en-IN')+'</div></div>'+
      '</div>'+
      '<div style="padding:0 16px;">'+entriesHtml+'</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 16px 14px;gap:8px;">'+
        (custIdAttr?'<button onclick="event.stopPropagation();addGirviLoanForCustomer(\''+custIdAttr+'\')" style="font-size:11px;padding:5px 14px;border-radius:20px;border:1px solid var(--gold-dark);background:rgba(201,168,76,.1);color:var(--gold-dark);cursor:pointer;font-family:inherit;font-weight:700;transition:background .15s;" onmouseover="this.style.background=\'rgba(201,168,76,.2)\'" onmouseout="this.style.background=\'rgba(201,168,76,.1)\'">+ Add Loan</button>':'<span></span>')+
        (custIdAttr?'<button onclick="event.stopPropagation();showCustomerEditModal(\''+custIdAttr+'\')" style="font-size:11px;padding:4px 12px;border-radius:20px;border:1px solid var(--border2);background:var(--card2);color:var(--text2);cursor:pointer;font-family:inherit;transition:opacity .15s;" onmouseover="this.style.opacity=\'.8\'" onmouseout="this.style.opacity=\'1\'">✏️ Edit Customer</button>':'')+
      '</div>'+
    '</div>';
  }).join('');

  var countEl = document.getElementById('girvi-count-label');
  if(countEl) countEl.textContent=rows.length+' customer account'+(rows.length===1?'':'s');
}

// ── FULL renderGirvi OVERRIDE (v20) ─────────────────────────────────
// Preserves all v19 logic, adds: exec dash, overdue banner, chip filters,
// metal filter, Edit+Ledger action buttons on every active card
var _v20_renderGirvi_installed = false;
(function(){
  if(_v20_renderGirvi_installed) return;
  _v20_renderGirvi_installed = true;

  renderGirvi = function(){
    var filter      = ((document.getElementById('girvi-filter-status')||{}).value)||'all';
    // Archived view — show only soft-deleted entries with recover option
    if(filter==='archived'){
      var archived=(S.girvi||[]).filter(function(g){return g._deleted;});
      var listEl=document.getElementById('girvi-list');
      if(!listEl) return;
      renderGirviExecDash();
      if(!archived.length){
        listEl.innerHTML='<div style="text-align:center;padding:3rem 1rem;color:var(--text3);">'+
          '<div style="font-size:32px;margin-bottom:8px;">🗃</div><div>No archived entries</div></div>';
        return;
      }
      listEl.innerHTML=archived.map(function(g){
        return '<div class="girvi-card status-closed" style="cursor:default;opacity:.8;">'+
          '<div class="girvi-card-top">'+
            '<div class="girvi-card-meta"><span class="girvi-card-id">'+escHtml(g.grvNo)+'</span>'+
            '<span style="font-size:10px;color:var(--text3);">Archived '+fmtDate(g._deletedAt)+'</span></div>'+
            '<div class="girvi-card-body">'+
              '<div class="girvi-card-left"><div class="girvi-card-name">'+escHtml(g.customer)+'</div>'+
              '<div class="girvi-card-item">'+((Array.isArray(g.items)&&g.items.length?g.items[0].type:g.item&&g.item.type)||'Item')+'</div></div>'+
              '<div class="girvi-card-right">'+
                '<div class="girvi-card-outstanding normal">₹'+Math.round(g.principal).toLocaleString('en-IN')+'</div>'+
                '<button onclick="recoverGirviEntry(\''+g.id+'\')" style="margin-top:6px;padding:5px 12px;border-radius:20px;border:1px solid #22c55e44;background:#22c55e12;color:#22c55e;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">↺ Recover</button>'+
              '</div>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');
      var cl=document.getElementById('girvi-count-label'); if(cl) cl.textContent=archived.length+' archived';
      return;
    }
    var girvi = (S.girvi||[]).filter(function(g){return !g._deleted;});
    var search      = ((document.getElementById('girvi-search')||{}).value||'').toLowerCase().trim();
    filter          = ((document.getElementById('girvi-filter-status')||{}).value)||'all';
    var metalFilter = ((document.getElementById('girvi-filter-metal')||{}).value)||'all';

    // Recompute statuses
    girvi.forEach(function(g){
      if(g.status!=='closed'&&g.status!=='defaulted') g.status = girviComputeStatus(g);
    });

    renderGirviExecDash();
    if(typeof renderGirviCP==='function') renderGirviCP();
    if(typeof renderGirviTodayActions==='function') renderGirviTodayActions();

    if(GIRVI_VIEW_MODE==='customer'){
      renderGirviByCustomer(search, filter, metalFilter);
      return;
    }

    var list = girvi.filter(function(g){
      var ms = !search||
        (g.customer||'').toLowerCase().indexOf(search)>-1||
        (g.phone||'').replace(/\D/g,'').indexOf(search.replace(/\D/g,''))>-1||
        (g.grvNo||'').toLowerCase().indexOf(search)>-1||
        (g.address||'').toLowerCase().indexOf(search)>-1||
        ((g.item&&g.item.desc)||'').toLowerCase().indexOf(search)>-1||
        ((g.item&&g.item.type)||'').toLowerCase().indexOf(search)>-1||
        (g.items||[]).some(function(it){
          return (it.desc||'').toLowerCase().indexOf(search)>-1||
                 (it.type||'').toLowerCase().indexOf(search)>-1||
                 (it.metal||'').toLowerCase().indexOf(search)>-1;
        })||
        (g.notes||'').toLowerCase().indexOf(search)>-1||
        (g.notesList||[]).some(function(n){return (n.text||'').toLowerCase().indexOf(search)>-1;});
      // When searching, include closed entries too so history is searchable
      var sf = filter==='all'||(search?true:g.status===filter)||(g.status===filter);
      if(!search) sf = filter==='all'||g.status===filter;
      var mf = metalFilter==='all'||(function(){
        var its = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
        return its.some(function(it){ return (it&&it.metal)===metalFilter; });
      })();
      var chip7  = !_girviChips['due7']  ||(function(){ var di=girviDaysInfo(g); return g.status!=='closed'&&di.daysLeft>=0&&di.daysLeft<=7; })();
      var chipHV = !_girviChips['highval']||(parseFloat(g.principal)||0)>=50000;
      return ms&&sf&&mf&&chip7&&chipHV;
    });

    var ord = {atrisk:0,defaulted:1,overdue:2,active:3,closed:4};
    list.sort(function(a,b){
      var d=(ord[a.status]||3)-(ord[b.status]||3);
      return d!==0?d:new Date(b.createdAt)-new Date(a.createdAt);
    });

    var listEl = document.getElementById('girvi-list');
    if(!listEl) return;
    listEl.dataset.page = listEl.dataset.page||'0';

    if(!list.length){
      listEl.innerHTML='<div style="text-align:center;padding:3rem 1rem;color:var(--text3);">'+
        (search||filter!=='all'
          ?'<div style="font-size:28px;margin-bottom:8px;">\ud83d\udd0d</div><div style="font-size:14px;">No results found</div><button class="btn" style="margin-top:10px;" onclick="document.getElementById(\'girvi-search\').value=\'\';resetGirviPage();">Clear Search</button>'
          :'<div style="font-size:40px;margin-bottom:10px;">\ud83e\ude99</div>'+
           '<div style="font-size:15px;font-weight:700;margin-bottom:6px;">No Girvi loans yet</div>'+
           '<div style="font-size:13px;margin-bottom:14px;color:var(--text3);">Start tracking pawn loans</div>'+
           '<button class="btn btn-gold" onclick="openGirviForm()" style="padding:12px 24px;font-size:14px;">+ New Girvi</button>')+
      '</div>';
      var cl = document.getElementById('girvi-count-label');
      if(cl) cl.textContent='';
      return;
    }

    var GIRVI_PAGE = 25;
    var pg = parseInt(listEl.dataset.page||'0');
    var pageItems = list.slice(0,(pg+1)*GIRVI_PAGE);
    var hasMore = list.length>pageItems.length;

    listEl.innerHTML = pageItems.map(function(g){
      var outstanding = girviOutstanding(g);
      var interest    = girviInterestAccrued(g);
      var penObj      = girviOutstandingWithPenalty(g);
      var penalty     = penObj.penalty;
      var daysInfo    = girviDaysInfo(g);
      var status      = g.status;
      var ltv         = girviLTV(g);
      var ltvL        = girviLTVLabel(ltv);

      var outColor = status==='closed'?'green':status==='defaulted'?'red':
        daysInfo.overdue>0?'red':daysInfo.daysLeft<=7&&daysInfo.daysLeft>=0?'amber':'normal';

      var daysBadge='', daysBadgeClass='days-na';
      if(status==='closed'){ daysBadge='Released'; daysBadgeClass='days-safe'; }
      else if(status==='defaulted'){ daysBadge='Defaulted'; daysBadgeClass='days-overdue'; }
      else if(daysInfo.overdue>0){ daysBadge=daysInfo.overdue+'d overdue'; daysBadgeClass='days-overdue'; }
      else if(daysInfo.daysLeft>=0){ daysBadge=daysInfo.daysLeft===0?'Due today!':daysInfo.daysLeft+'d left'; daysBadgeClass=daysInfo.daysLeft<=3?'days-overdue':daysInfo.daysLeft<=7?'days-soon':'days-safe'; }
      else { daysBadge='No term'; daysBadgeClass='days-na'; }

      var _allIt = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
      var _cw = _allIt.reduce(function(s,it){ return s+(parseFloat(it.weight||it.grossWt)||0)*(parseInt(it.qty)||1); },0);
      var itemHtml;
      if(_allIt.length===1){
        var it0=_allIt[0];
        itemHtml='<div class="girvi-card-item">'+escHtml(it0.desc||it0.type||'Item')+
          ' \u2022 '+(it0.purity||'')+' '+(it0.metal||'')+
          (_cw?' \u2022 '+_cw.toFixed(2)+'g':'')+
          ' \u2022 Mkt: \u20b9'+Math.round(getRate(it0.metal||'gold',it0.purity||'22K')*girviItemWt(it0)*(parseInt(it0.qty)||1)).toLocaleString('en-IN')+'</div>';
      } else {
        itemHtml='<div class="girvi-card-item"><span style="background:rgba(201,168,76,.15);color:var(--gold-dark);font-weight:700;font-size:10px;padding:1px 6px;border-radius:8px;margin-right:4px;">'+_allIt.length+' items</span>'+_cw.toFixed(2)+'g \u2022 '+_allIt.map(function(it){ return it.type||'Item'; }).join(', ')+'</div>';
      }

      var actionsHtml;
      if(status==='closed'){
        actionsHtml='<div style="text-align:center;font-size:11px;color:var(--text3);padding:8px;border-top:0.5px solid var(--border);">\ud83d\udd12 Released '+(g.closedAt?fmtDate(g.closedAt):'')+'</div>';
      } else {
        actionsHtml='<div class="girvi-card-actions" onclick="event.stopPropagation();">'+
          '<button class="gca call-btn" onclick="callCustomer(\''+jsAttrEsc(g.phone)+'\')"><span class="gca-icon">\ud83d\udcde</span>Call</button>'+
          '<button class="gca wa-btn" onclick="girviWhatsApp(\''+g.id+'\')"><span class="gca-icon">\ud83d\udcac</span>WA</button>'+
          '<button class="gca pay-btn" onclick="openGirviPayment(\''+g.id+'\')"><span class="gca-icon">\u20b9</span>Pay</button>'+
          '<button class="gca edit-btn" onclick="openGirviEditModal(\''+g.id+'\')"><span class="gca-icon">\u270f\ufe0f</span>Edit</button>'+
          '<button class="gca ledger-btn" onclick="openGirviLedger(\''+g.id+'\')"><span class="gca-icon">\ud83d\udcd2</span>Ledger</button>'+
          '<button class="gca archive-btn" onclick="deleteGirviEntry(\''+g.id+'\')"><span class="gca-icon">\ud83d\udce6</span>Archive</button>'+
        '</div>';
      }

      return '<div class="girvi-card status-'+status+'" onclick="openGirviDetail(\''+g.id+'\')">'+
        '<div class="girvi-card-top">'+
          '<div class="girvi-card-meta">'+
            '<div>'+
              '<span class="girvi-card-id">'+g.grvNo+'</span>'+
              ' <span class="girvi-card-days '+daysBadgeClass+'">'+daysBadge+'</span>'+
              ' '+girviRiskBadge(g.risk)+
            '</div>'+
            '<div class="girvi-card-date">'+fmtDate(g.startDate)+'</div>'+
          '</div>'+
          '<div class="girvi-card-body">'+
            '<div class="girvi-card-left">'+
              '<div class="girvi-card-name">'+escHtml(g.customer)+'</div>'+
              '<div class="girvi-card-phone">\ud83d\udcde '+escHtml(g.phone)+'</div>'+
              itemHtml+
              (g.staff?'<div style="font-size:10px;color:var(--text3);margin-top:1px;">\ud83d\udc64 '+escHtml(g.staff)+'</div>':'')+
            '</div>'+
            '<div class="girvi-card-right">'+
              '<div class="girvi-card-outstanding '+outColor+'">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</div>'+
              '<div class="girvi-card-principal">\u20b9'+Math.round(g.principal).toLocaleString('en-IN')+' @ '+g.interestRate+'%'+(g.rateType==='yearly'?'/yr':'/mo')+'</div>'+
              (interest>0?'<div class="girvi-card-interest">+\u20b9'+Math.round(interest).toLocaleString('en-IN')+' interest</div>':'')+
              (penalty>0?'<div style="font-size:10px;color:#ef4444;font-weight:700;">+\u20b9'+Math.round(penalty).toLocaleString('en-IN')+' penalty</div>':'')+
              '<div style="font-size:10px;color:'+ltvL.color+';margin-top:2px;">'+ltvL.icon+' LTV '+(ltv*100).toFixed(0)+'%</div>'+
            '</div>'+
          '</div>'+
        '</div>'+
        actionsHtml+
      '</div>';
    }).join('');

    if(hasMore){
      listEl.innerHTML+='<div style="text-align:center;padding:12px 0;">'+
        '<button onclick="(function(){var el=document.getElementById(\'girvi-list\');el.dataset.page=(parseInt(el.dataset.page||0)+1);renderGirvi();})()" '+
        'class="btn btn-gold" style="padding:10px 28px;font-size:13px;">\u2b07 Load more ('+(list.length-pageItems.length)+' remaining)</button></div>';
    }

    var countEl = document.getElementById('girvi-count-label');
    if(countEl) countEl.textContent='Showing '+pageItems.length+' of '+list.length;
  };
}());

// ── GIRVI EDIT MODAL ─────────────────────────────────────────────────
function openGirviEditModal(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Girvi not found');return;}
  if(g.status==='closed'){toast('Closed entries cannot be edited');return;}

  _geEditId=gid;
  GE_ITEMS=(Array.isArray(g.items)&&g.items.length)
    ?g.items.map(function(it){return{type:it.type||'Ring',metal:it.metal||'gold',purity:it.purity||'22K',grossWt:parseFloat(it.weight||it.grossWt)||0,netWt:parseFloat(it.netWt)||0,qty:parseInt(it.qty)||1,desc:it.desc||''};})
    :g.item?[{type:g.item.type||'Ring',metal:g.item.metal||'gold',purity:g.item.purity||'22K',grossWt:parseFloat(g.item.weight)||0,netWt:parseFloat(g.item.netWt)||0,qty:parseInt(g.item.qty)||1,desc:g.item.desc||''}]
    :[{type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''}];

  document.getElementById('ge-modal-title').innerHTML='\u270f\ufe0f Edit '+escHtml(g.grvNo);
  document.getElementById('ge-cust').value=g.customer||'';
  document.getElementById('ge-phone').value=g.phone||'';
  document.getElementById('ge-addr').value=g.address||'';
  document.getElementById('ge-risk').value=g.risk||'medium';
  document.getElementById('ge-staff').value=g.staff||'';
  document.getElementById('ge-remarks').value=g.notes||'';
  document.getElementById('ge-principal').value=g.principal||'';
  document.getElementById('ge-rate').value=g.interestRate||2;
  document.getElementById('ge-ratetype').value=g.rateType||'monthly';
  document.getElementById('ge-duration').value=g.duration||'';
  document.getElementById('ge-compound').checked=!!g.compound;
  document.getElementById('ge-startdate').value=g.startDate||'';
  document.getElementById('ge-edit-reason').value='';

  geUpdateDueDate();
  geRenderItems();
  geRenderDocs(g);
  geRenderAuditLog(g);
  geTab('customer',document.querySelector('#girvi-edit-modal .ge-tab'));

  document.getElementById('girvi-edit-modal').style.display='block';
  setTimeout(function(){var el=document.getElementById('ge-cust');if(el)el.focus();},150);
}

function closeGirviEditModal(){
  document.getElementById('girvi-edit-modal').style.display='none';
  _geEditId=null; GE_ITEMS=[];
}

function geTab(name,btn){
  document.querySelectorAll('#girvi-edit-modal .ge-tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('#girvi-edit-modal .ge-tab-panel').forEach(function(p){p.classList.remove('active');});
  if(btn) btn.classList.add('active');
  var panel=document.getElementById('ge-panel-'+name);
  if(panel) panel.classList.add('active');
  if(name==='loan') geUpdateDueDate();
  if(name==='ornament') geRenderItems();
}

function geUpdateDueDate(){
  var start=(document.getElementById('ge-startdate')||{}).value||'';
  var dur=parseInt((document.getElementById('ge-duration')||{}).value)||0;
  var el=document.getElementById('ge-duedate-display');
  if(!el) return;
  if(start&&dur){
    var d=new Date(start); d.setMonth(d.getMonth()+dur);
    el.textContent=fmtDate(dbDayKey(d));
    el.style.color='var(--gold-dark)';
  } else {
    el.textContent=dur?'Set start date':'No fixed term';
    el.style.color='var(--text3)';
  }
  var p=parseFloat((document.getElementById('ge-principal')||{}).value)||0;
  var r=parseFloat((document.getElementById('ge-rate')||{}).value)||0;
  var rt=((document.getElementById('ge-ratetype')||{}).value)||'monthly';
  var cp=((document.getElementById('ge-compound')||{}).checked)||false;
  var prev=document.getElementById('ge-recalc-preview');
  if(prev&&p&&r&&dur){
    var rm=rt==='yearly'?r/12:r;
    var interest=cp?p*(Math.pow(1+rm/100,dur)-1):p*rm/100*dur;
    prev.style.display='';
    prev.innerHTML='<strong style="color:var(--gold-dark);">\ud83d\udcca Recalculated Preview</strong><br>'+
      'Principal: <strong>\u20b9'+Math.round(p).toLocaleString('en-IN')+'</strong> &nbsp;|&nbsp; '+
      'Interest ('+dur+'mo): <strong style="color:var(--warning);">\u20b9'+Math.round(interest).toLocaleString('en-IN')+'</strong> &nbsp;|&nbsp; '+
      'Total: <strong style="color:var(--gold-dark);">\u20b9'+Math.round(p+interest).toLocaleString('en-IN')+'</strong>';
  } else if(prev){ prev.style.display='none'; }
}

function geRenderItems(){
  var wrap=document.getElementById('ge-items-list');
  if(!wrap) return;
  if(!GE_ITEMS.length) GE_ITEMS=[{type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''}];
  wrap.innerHTML='';
  GE_ITEMS.forEach(function(item,i){ wrap.appendChild(geItemCard(i,item)); });
}

function geAddItem(){
  GE_ITEMS.push({type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''});
  geRenderItems();
}

function geRemoveItem(i){
  if(GE_ITEMS.length<=1){toast('At least one item required');return;}
  GE_ITEMS.splice(i,1);
  geRenderItems();
}

function geItemCard(i,item){
  var TYPES=['Ring','Necklace','Bangle','Earring','Chain','Pendant','Payal','Bracelet','Maangtikka','Kamarbandh','Other'];
  var GPURITY=['24K','22K','18K','14K','Gold Plated'];
  var SPURITY=['999 Pure','925 Sterling','800','Silver Plated'];

  var card=document.createElement('div');
  card.style.cssText='background:var(--card2);border:1.5px solid rgba(201,168,76,.25);border-radius:12px;padding:12px 13px;margin-bottom:10px;';

  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
  hdr.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--gold-dark);text-transform:uppercase;letter-spacing:.06em;">Item '+(i+1)+'</div>';
  if(GE_ITEMS.length>1){
    var rb=document.createElement('button');
    rb.style.cssText='padding:3px 10px;border-radius:8px;border:none;background:rgba(168,49,42,.1);color:var(--danger);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;';
    rb.textContent='Remove';
    (function(idx){rb.onclick=function(){geRemoveItem(idx);};})(i);
    hdr.appendChild(rb);
  }
  card.appendChild(hdr);

  var grid=document.createElement('div');
  grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;';

  function fld(lbl,html){var d=document.createElement('div');d.className='ge-fg';d.innerHTML='<label>'+lbl+'</label>'+html;return d;}

  var typeOpts=TYPES.map(function(t){return '<option value="'+t+'"'+(t===item.type?' selected':'')+'>'+t+'</option>';}).join('');
  var typeSel=fld('Type','<select id="gei-type-'+i+'">'+typeOpts+'</select>');
  (function(idx){typeSel.querySelector('select').onchange=function(){GE_ITEMS[idx].type=this.value;};})(i);
  grid.appendChild(typeSel);

  var descFld=fld('Description','<input id="gei-desc-'+i+'" placeholder="e.g. Gold Haar" value="'+escHtml(item.desc||'')+'"/>');
  (function(idx){descFld.querySelector('input').oninput=function(){GE_ITEMS[idx].desc=this.value;};})(i);
  grid.appendChild(descFld);

  var metalSel=fld('Metal','<select id="gei-metal-'+i+'"><option value="gold"'+(item.metal==='gold'?' selected':'')+'>Gold</option><option value="silver"'+(item.metal==='silver'?' selected':'')+'>Silver</option></select>');
  (function(idx){metalSel.querySelector('select').onchange=function(){GE_ITEMS[idx].metal=this.value;GE_ITEMS[idx].purity=this.value==='gold'?'22K':'925 Sterling';geRenderItems();};})(i);
  grid.appendChild(metalSel);

  var purOpts=(item.metal==='silver'?SPURITY:GPURITY).map(function(p){return '<option value="'+p+'"'+(p===item.purity?' selected':'')+'>'+p+'</option>';}).join('');
  var purSel=fld('Purity','<select id="gei-purity-'+i+'">'+purOpts+'</select>');
  (function(idx){purSel.querySelector('select').onchange=function(){GE_ITEMS[idx].purity=this.value;};})(i);
  grid.appendChild(purSel);

  var gwFld=fld('Gross Wt (g)','<input id="gei-gw-'+i+'" type="text" inputmode="decimal" placeholder="0.000" value="'+(item.grossWt>0?item.grossWt:'')+'"/>');
  (function(idx){gwFld.querySelector('input').oninput=function(){GE_ITEMS[idx].grossWt=parseFloat(this.value)||0;};})(i);
  grid.appendChild(gwFld);

  var nwFld=fld('Net Wt (g)','<input id="gei-nw-'+i+'" type="text" inputmode="decimal" placeholder="0.000" value="'+(item.netWt>0?item.netWt:'')+'"/>');
  (function(idx){nwFld.querySelector('input').oninput=function(){GE_ITEMS[idx].netWt=parseFloat(this.value)||0;};})(i);
  grid.appendChild(nwFld);

  card.appendChild(grid);

  var mktRate=getRate(item.metal||'gold',item.purity||'22K');
  var mktVal=mktRate*girviItemWt(item);
  if(mktVal>0){
    var mv=document.createElement('div');
    mv.style.cssText='font-size:11px;color:var(--gold-dark);font-weight:600;margin-top:6px;background:rgba(201,168,76,.08);border-radius:6px;padding:5px 8px;';
    mv.innerHTML='\ud83d\udcca Mkt Val: \u20b9'+Math.round(mktVal).toLocaleString('en-IN')+' &nbsp;\u2022&nbsp; 70% LTV: \u20b9'+Math.round(mktVal*0.7).toLocaleString('en-IN');
    card.appendChild(mv);
  }

  return card;
}

function geRenderDocs(g){
  var docs=g.documents||{};
  function renderSlots(cid,keys,labels){
    var c=document.getElementById(cid);
    if(!c) return;
    c.innerHTML='';
    keys.forEach(function(k,i){
      var val=docs[k]||'';
      var slot=document.createElement('div');
      slot.className='doc-slot'+(val?' filled':'');
      if(val){
        slot.innerHTML='<img src="'+escHtml(val)+'" onerror="this.style.display=\'none\'">'
          +'<button class="doc-slot-del" onclick="event.stopPropagation();geDelDoc(\''+k+'\',\''+cid+'\')">\u2715</button>'
          +'<div class="doc-slot-label" style="position:absolute;bottom:4px;left:0;right:0;text-align:center;background:rgba(0,0,0,.55);color:#fff;font-size:8px;padding:2px;">'+labels[i]+'</div>';
      } else {
        slot.innerHTML='<div class="doc-slot-icon">\ud83d\udcc4</div><div class="doc-slot-label">'+labels[i]+'</div>';
      }
      (function(key,ci2){slot.onclick=function(){
        var url=prompt('Paste image URL (or leave blank to clear):',docs[key]||'');
        if(url===null) return;
        geSetDoc(key,url,ci2);
      };})(k,cid);
      c.appendChild(slot);
    });
  }
  renderSlots('ge-docs-ornament',['ornament_1','ornament_2','ornament_3'],['Item Photo 1','Item Photo 2','Item Photo 3']);
  renderSlots('ge-docs-other',['signature','customer_photo','receipt'],['Signature','Customer Photo','Receipt']);
}

function geSetDoc(key,url,cid){
  var g=_geEditId?(S.girvi||[]).find(function(x){return x.id===_geEditId;}):null;
  if(!g) return;
  if(!g.documents) g.documents={};
  if(url) g.documents[key]=url; else delete g.documents[key];
  geRenderDocs(g);
  saveToCloud(function(err){if(!err) toast('Document saved');});
}

function geDelDoc(key,cid){ geSetDoc(key,'',cid); }

function geRenderAuditLog(g){
  var el=document.getElementById('ge-audit-list');
  if(!el) return;
  var ledger=(g.ledger||[]).slice().reverse();
  if(!ledger.length){el.innerHTML='<div style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">No changes recorded yet.</div>';return;}
  var ICONS={created:'\ud83d\udfe2',payment:'\ud83d\udcb8',edit:'\u270f\ufe0f',closed:'\ud83d\udd12',defaulted:'\ud83d\udd34',renewal:'\ud83d\udd04',whatsapp:'\ud83d\udcac',waiver:'\ud83c\udff7',penalty:'\u26a0'};
  el.innerHTML=ledger.map(function(l){
    return '<div class="ge-audit-entry">'+
      '<div class="ge-audit-dot '+(l.type||'edit')+'"></div>'+
      '<div style="flex:1;">'+
        '<div style="font-size:12px;font-weight:600;color:var(--ink);">'+(ICONS[l.type]||'\ud83d\udccb')+' '+escHtml(l.note||l.type||'Change')+'</div>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:2px;">'+fmtDate(l.ts)+' '+fmtTime(l.ts)+(l.user?' \u2022 '+escHtml(l.user):'')+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// ── SAVE GIRVI EDIT ──────────────────────────────────────────────────
function saveGirviEdit(){
  if(!_geEditId){toast('No girvi selected');return;}
  var g=(S.girvi||[]).find(function(x){return x.id===_geEditId;});
  if(!g){toast('Girvi not found');return;}
  if(_girviLocked(g.id)){ toast('Already saving — please wait'); return; }

  var cust=(document.getElementById('ge-cust').value||'').trim();
  var phone=(document.getElementById('ge-phone').value||'').trim();
  if(!cust){toast('\u26a0 Customer name required');return;}
  if(!phone){toast('\u26a0 Phone required');return;}
  if(normPhone(phone).length<10){toast('\u26a0 Enter a valid 10-digit phone number');return;}

  var principal=parseFloat(document.getElementById('ge-principal').value);
  var rate=parseFloat(document.getElementById('ge-rate').value);
  if(!principal||principal<=0){toast('\u26a0 Loan amount required');return;}
  if(!rate||rate<=0){toast('\u26a0 Interest rate required');return;}

  var _geStart=document.getElementById('ge-startdate').value;
  if(!_geStart){toast('\u26a0 Enter start date');return;}
  if(new Date(_geStart).getTime() > Date.now()+86400000){toast('\u26a0 Start date cannot be in the future');return;}
  var _geDur=parseInt(document.getElementById('ge-duration').value);
  if(_geDur && _geDur<0){toast('\u26a0 Duration cannot be negative');return;}

  var _si=GE_ITEMS.filter(function(it){return (parseFloat(it.grossWt)||0)>0;});
  if(!_si.length){toast('\u26a0 At least one item with weight required');return;}

  var reason=(document.getElementById('ge-edit-reason').value||'').trim()||'Manual edit';
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';

  // Build diff
  var changes=[];
  function chk(lbl,ov,nv){if(String(ov||'')!==String(nv||''))changes.push(lbl+': ['+ov+'] \u2192 ['+nv+']');}
  chk('Name',g.customer,cust);
  chk('Phone',g.phone,phone);
  chk('Principal',g.principal,principal);
  chk('Rate',g.interestRate,rate);
  chk('Address',g.address,(document.getElementById('ge-addr').value||'').trim());
  chk('Duration',g.duration,parseInt(document.getElementById('ge-duration').value)||0);
  chk('Staff',g.staff,(document.getElementById('ge-staff').value||'').trim());

  var oldSnap={customer:g.customer,phone:g.phone,principal:g.principal,interestRate:g.interestRate};
  var _fullSnap = _girviSnapshot(g.id);
  _girviLock(g.id);

  // Apply
  g.customer   =cust;
  g.phone      =phone;
  g.risk       =document.getElementById('ge-risk').value;
  g.address    =(document.getElementById('ge-addr').value||'').trim();
  g.staff      =(document.getElementById('ge-staff').value||'').trim();
  g.notes      =(document.getElementById('ge-remarks').value||'').trim();
  g.items      =_si.map(function(it){return{type:it.type,metal:it.metal,purity:it.purity,weight:parseFloat(it.grossWt)||0,netWt:parseFloat(it.netWt)||0,qty:parseInt(it.qty)||1,desc:it.desc};});
  g.item       =g.items[0];
  g.principal  =principal;
  g.interestRate=rate;
  g.rateType   =document.getElementById('ge-ratetype').value;
  g.compound   =document.getElementById('ge-compound').checked;
  g.startDate  =document.getElementById('ge-startdate').value;
  g.duration   =parseInt(document.getElementById('ge-duration').value)||0;
  g.status     =girviComputeStatus(g);
  linkGirviToCustomer(g); // re-link in case name/phone changed
  var changeNote = reason + (changes.length ? ' | ' + changes.join('; ') : '');
  if(!g.ledger)g.ledger=[];
  g.ledger.push({type:'edit',note:changeNote,ts:new Date().toISOString(),user:currentUser,oldValues:oldSnap});

  if(typeof auditLog==='function') auditLog('update','girvi',g.id,'Edit: '+reason);
  if(typeof saasActivityLog==='function') saasActivityLog('girvi','Edited '+g.grvNo+': '+reason);

  closeGirviEditModal();
  // Foundation audit B2: "Saved locally. Sync pending." previously left
  // the edit applied in this tab forever on a failed/conflicted save,
  // with no actual retry — now reverted to the pre-edit snapshot instead.
  _girviCommit(g.id, {snapshot:_fullSnap}, function(err){
    if(err) return;
    renderGirvi(); renderDash();
    toast('\u2705 '+g.grvNo+' updated!');
  });
}

// ── PAYMENT LEDGER MODAL ─────────────────────────────────────────────
function openGirviLedger(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  _glGirviId=gid;
  _glEntryType='payment';
  document.getElementById('gl-modal-title').innerHTML='\ud83d\udcd2 Ledger \u2014 '+escHtml(g.grvNo)+' ('+escHtml(g.customer)+')';
  var dateEl=document.getElementById('gl-date');
  if(dateEl) dateEl.value=dbDayKey(new Date());
  document.querySelectorAll('.gl-type-btn').forEach(function(b){b.classList.remove('active');});
  var fb=document.querySelector('.gl-type-btn');
  if(fb) fb.classList.add('active');
  glRenderSummary(g);
  glRenderEntries(g);
  document.getElementById('girvi-ledger-modal').style.display='block';
  setTimeout(function(){var a=document.getElementById('gl-amount');if(a)a.focus();},150);
}

function closeGirviLedgerModal(){
  document.getElementById('girvi-ledger-modal').style.display='none';
  _glGirviId=null;
}

function glSetType(type,btn){
  _glEntryType=type;
  document.querySelectorAll('.gl-type-btn').forEach(function(b){b.classList.remove('active');});
  if(btn) btn.classList.add('active');
  glUpdateBalance();
}

function glUpdateBalance(){
  var g=_glGirviId?(S.girvi||[]).find(function(x){return x.id===_glGirviId;}):null;
  if(!g) return;
  var amt=parseFloat((document.getElementById('gl-amount')||{}).value)||0;
  var el=document.getElementById('gl-balance-preview');
  if(!el) return;
  if(!amt){el.innerHTML='';return;}
  var outstanding=girviOutstandingWithPenalty(g).amount;
  if(_glEntryType==='payment'||_glEntryType==='interest'){
    var remaining=Math.max(0,outstanding-amt);
    el.innerHTML=remaining<=0
      ?'<span style="color:#22c55e;font-weight:700;">\u2713 Full payment \u2014 loan will be CLOSED.</span>'
      :'<span style="color:var(--text3);">Balance after: <strong style="color:var(--ink);">\u20b9'+Math.round(remaining).toLocaleString('en-IN')+'</strong></span>';
  } else if(_glEntryType==='waiver'){
    el.innerHTML='<span style="color:var(--warning);">\ud83c\udff7 Waiver of \u20b9'+Math.round(amt).toLocaleString('en-IN')+' will reduce outstanding.</span>';
  } else if(_glEntryType==='penalty'){
    el.innerHTML='<span style="color:var(--danger);">\u26a0 Penalty of \u20b9'+Math.round(amt).toLocaleString('en-IN')+' will be added.</span>';
  } else {
    el.innerHTML='';
  }
}

function glRenderSummary(g){
  var el=document.getElementById('gl-summary');
  if(!el) return;
  var outstanding=girviOutstandingWithPenalty(g).amount;
  var totalPaid=girviTotalPaid(g);
  var interest=girviInterestAccrued(g);
  var loanBalance=girviLedgerState(g).principal;
  el.innerHTML=
    '<div class="gl-sum-card"><div class="gl-sum-val" style="color:var(--gold-dark);">\u20b9'+Math.round(loanBalance).toLocaleString('en-IN')+'</div><div class="gl-sum-lbl">Loan Balance</div></div>'+
    '<div class="gl-sum-card"><div class="gl-sum-val" style="color:var(--success);">\u20b9'+Math.round(totalPaid).toLocaleString('en-IN')+'</div><div class="gl-sum-lbl">Total Paid</div></div>'+
    '<div class="gl-sum-card"><div class="gl-sum-val" style="color:'+(outstanding>0?'var(--danger)':'var(--success)')+';">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</div><div class="gl-sum-lbl">Outstanding</div></div>'+
    '<div class="gl-sum-card"><div class="gl-sum-val" style="color:var(--warning);">\u20b9'+Math.round(interest).toLocaleString('en-IN')+'</div><div class="gl-sum-lbl">Accrued Interest</div></div>';
}

// When a girvi event actually happened, for display and ordering.
// A payment carries two times: `date` (the day the customer paid, which may be
// entered late) and `ts` (the moment someone typed it in). Every girvi view
// used to show `ts` first, so a payment backdated to 8 Aug and entered on
// 18 Sep read "18 Sep" — on exactly the entries where backdating was the
// point. The interest engine was always right; only these views were wrong.
//
// Recording a payment also writes an activity row into g.ledger, which only
// gained a `date` on 18 Sep. For older rows the payment it belongs to is
// found by time: both are written in the same save, under a per-loan lock
// (_girviLock) so two payments on one loan cannot interleave. Only an
// unambiguous single match is used — this never guesses a date.
function girviEventDate(g, e){
  if(e.date) return e.date;
  if(e.type !== 'payment' || !e.ts) return e.ts;
  var at = new Date(e.ts).getTime();
  var near = (g.payments||[]).filter(function(p){
    return p.date && p.ts && Math.abs(new Date(p.ts).getTime() - at) < 5000;
  });
  return near.length === 1 ? near[0].date : e.ts;
}
// QA 1 Oct P1-10: every money entry is written to g.payments AND as a "\u20b9..." note
// in g.ledger, so history views listed each payment twice. Views show the
// payments row (it has the amount) and skip the matching ledger note.
function girviLedgerIsPayment(l){ return /^(payment|interest|waiver|penalty|refund)$/.test(l.type) && /^\u20b9/.test(l.note||''); }
var GIRVI_PAY_LABEL={general:'Payment',payment:'Payment',partial:'Partial repayment',full:'Full redemption',interest:'Interest',waiver:'Waiver',penalty:'Penalty charged',refund:'Refund'};
function girviPayLabel(p){ return GIRVI_PAY_LABEL[p.type]||'Payment'; }
// A bare YYYY-MM-DD has no time of day. Printing one would invent a time.
function girviIsDateOnly(v){ return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

function glRenderEntries(g){
  var el=document.getElementById('gl-entries');
  if(!el) return;
  var entries=[];
  (g.ledger||[]).forEach(function(l){if(girviLedgerIsPayment(l))return;entries.push({ts:girviEventDate(g,l),type:l.type,note:l.note,amount:l.amount||null,mode:null,user:l.user||''});});
  (g.payments||[]).forEach(function(p){var dt=/^(penalty|refund|waiver)$/.test(p.type);entries.push({ts:p.date||p.ts,type:dt?p.type:'payment_entry',note:girviPayLabel(p),amount:parseFloat(p.amount)||0,mode:p.type==='waiver'?null:p.mode,ref:p.ref||''});});
  entries.sort(function(a,b){return new Date(b.ts)-new Date(a.ts);});

  var ICONS={payment:'\ud83d\udcb8',payment_entry:'\ud83d\udcb8',interest:'\ud83d\udcc8',waiver:'\ud83c\udff7',penalty:'\u26a0',refund:'\u21a9',created:'\ud83d\udfe2',closed:'\ud83d\udd12',renewal:'\ud83d\udd04',edit:'\u270f\ufe0f',defaulted:'\ud83d\udd34',whatsapp:'\ud83d\udcac'};
  var DEBIT_TYPES={penalty:1,refund:1};

  el.innerHTML=entries.length?entries.map(function(e){
    var icon=ICONS[e.type]||'\ud83d\udccb';
    var isDebit=!!DEBIT_TYPES[e.type];
    var amtHtml=e.amount!=null?'<div class="gl-entry-amt '+(isDebit?'debit':'credit')+'">\u20b9'+Math.round(e.amount).toLocaleString('en-IN')+'</div>':'';
    return '<div class="gl-entry">'+
      '<div class="gl-entry-left">'+
        '<div style="font-weight:700;font-size:13px;">'+icon+' '+escHtml(e.note||e.type||'Entry')+'</div>'+
        amtHtml+
        '<div class="gl-entry-meta">'+(e.mode?e.mode+' ':'')+(e.ref?'Ref: '+escHtml(e.ref):'')+(e.user?' \u2022 '+escHtml(e.user):'')+'</div>'+
      '</div>'+
      '<div class="gl-entry-right">'+
        '<div class="gl-entry-date">'+fmtDate(e.ts)+'</div>'+
        '<div class="gl-entry-time">'+(girviIsDateOnly(e.ts)?'':fmtTime(e.ts))+'</div>'+
      '</div>'+
    '</div>';
  }).join(''):'<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">No ledger entries yet.</div>';
}

function submitLedgerEntry(){
  var g=_glGirviId?(S.girvi||[]).find(function(x){return x.id===_glGirviId;}):null;
  if(!g){toast('No girvi selected');return;}
  if(_girviLocked(g.id)){ toast('Entry already being recorded — please wait'); return; }
  var amt=parseFloat((document.getElementById('gl-amount')||{}).value);
  var mode=(document.getElementById('gl-mode')||{}).value||'Cash';
  var date=(document.getElementById('gl-date')||{}).value||dbDayKey(new Date());
  var ref=((document.getElementById('gl-ref')||{}).value||'').trim();
  var note=((document.getElementById('gl-note')||{}).value||'').trim();
  var type=_glEntryType;
  if(!amt||amt<=0){toast('\u26a0 Enter a valid amount');return;}

  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  var ts=new Date().toISOString();
  var labels={payment:'Payment received',interest:'Interest cleared',waiver:'Waiver applied',penalty:'Penalty charged',refund:'Refund issued'};
  var noteText='\u20b9'+Math.round(amt).toLocaleString('en-IN')+' '+( note||(labels[type]||type))+(mode&&type!=='waiver'?' via '+mode:'')+(ref?' ('+ref+')':'');

  var _snap = _girviSnapshot(g.id);
  _girviLock(g.id);

  if(!g.payments) g.payments=[];
  if(!g.ledger) g.ledger=[];

  if(type==='payment'||type==='interest'){
    var pid=(typeof crypto.randomUUID==='function')?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
    if(!g.payments)g.payments=[];
    g.payments.push({id:pid,amount:amt,mode:mode,date:date,ref:ref,ts:ts,type:type});
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'payment',note:noteText,ts:ts,date:date,user:currentUser});
    var newOut=girviOutstanding(g);
    if(newOut<=0.5){
      g.status='closed'; g.closedAt=ts;
      if(!g.ledger)g.ledger=[];
      g.ledger.push({type:'closed',note:'Fully settled and closed',ts:ts,user:currentUser});
    } else {
      g.status=girviComputeStatus(g);
    }
  } else if(type==='waiver'){
    var wid=(typeof crypto.randomUUID==='function')?crypto.randomUUID():Date.now().toString(36);
    if(!g.payments)g.payments=[];
    g.payments.push({id:wid,amount:amt,mode:'Waiver',date:date,ref:ref,ts:ts,type:'waiver'});
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'waiver',note:noteText,ts:ts,user:currentUser});
    g.status=girviComputeStatus(g);
  } else if(type==='penalty'){
    var penId=(typeof crypto.randomUUID==='function')?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
    g.payments.push({id:penId,amount:amt,mode:mode,date:date,ref:ref,ts:ts,type:'penalty'});
    if(!g.penalties) g.penalties=[]; // kept for audit-trail granularity
    g.penalties.push({amount:amt,date:date,reason:note||'Late penalty',ts:ts});
    g.ledger.push({type:'penalty',note:noteText,ts:ts,user:currentUser});
    g.status=girviComputeStatus(g);
  } else if(type==='refund'){
    var refId=(typeof crypto.randomUUID==='function')?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
    g.payments.push({id:refId,amount:amt,mode:mode,date:date,ref:ref,ts:ts,type:'refund'});
    if(!g.refunds) g.refunds=[]; // kept for audit-trail granularity
    g.refunds.push({amount:amt,date:date,reason:note||'Refund',ts:ts});
    g.ledger.push({type:'refund',note:noteText,ts:ts,user:currentUser,amount:amt});
  }

  if(typeof auditLog==='function') auditLog('payment','girvi',g.id,noteText);
  if(typeof saasActivityLog==='function') saasActivityLog('girvi',g.grvNo+' '+type+': \u20b9'+Math.round(amt));

  // Clear form fields
  document.getElementById('gl-amount').value='';
  document.getElementById('gl-note').value='';
  if(document.getElementById('gl-ref')) document.getElementById('gl-ref').value='';
  document.getElementById('gl-balance-preview').innerHTML='';

  glRenderSummary(g);
  glRenderEntries(g);
  // Foundation audit B2: was a bare-callback saveToCloud() with no
  // rollback and no lock — a failed/conflicted save could leave a
  // waiver/penalty/closure recorded here that never reached the cloud.
  var _gidForCommit = g.id;
  _girviCommit(_gidForCommit, {snapshot:_snap}, function(err){
    if(err) return; // toast + revert already handled by _girviCommit
    renderGirvi(); renderDash();
    toast('\u2705 '+noteText+' recorded!');
    // One-click path to the receipt + WhatsApp share, instead of making
    // the owner hunt for the Receipt button after every payment.
    if((type==='payment'||type==='interest') && typeof openGirviReceiptModal==='function'){
      setTimeout(function(){ openGirviReceiptModal(_gidForCommit,'payment'); },300);
    }
  });
}

// ── CUSTOMER TIMELINE MODAL ──────────────────────────────────────────
function openGirviTimeline(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  document.getElementById('gt-modal-title').innerHTML='\ud83d\udccb Timeline \u2014 '+escHtml(g.customer);
  var events=[];
  (g.ledger||[]).forEach(function(l){if(girviLedgerIsPayment(l))return;events.push({ts:girviEventDate(g,l),type:l.type||'edit',title:l.note||l.type,sub:l.user||''});});
  (g.payments||[]).forEach(function(p){events.push({ts:p.date||p.ts,type:/^(penalty|refund|waiver)$/.test(p.type)?p.type:'payment',title:girviPayLabel(p)+': \u20b9'+Math.round(parseFloat(p.amount)||0).toLocaleString('en-IN')+' via '+p.mode,sub:p.ref||''});});
  events.sort(function(a,b){return new Date(b.ts)-new Date(a.ts);});
  var ICONS={created:'\ud83d\udfe2',payment:'\ud83d\udcb8',edit:'\u270f\ufe0f',closed:'\ud83d\udd12',renewal:'\ud83d\udd04',defaulted:'\ud83d\udd34',whatsapp:'\ud83d\udcac',waiver:'\ud83c\udff7',penalty:'\u26a0'};
  var body=document.getElementById('gt-body');
  if(!body) return;
  body.innerHTML=events.length?events.map(function(e){
    return '<div class="gt-item">'+
      '<div class="gt-dot '+(e.type||'edit')+'">'+(ICONS[e.type]||'\ud83d\udccb')+'</div>'+
      '<div class="gt-content">'+
        '<div class="gt-title">'+escHtml(e.title||e.type)+'</div>'+
        '<div class="gt-sub">'+fmtDate(e.ts)+(girviIsDateOnly(e.ts)?'':' '+fmtTime(e.ts))+(e.sub?' \u2022 '+escHtml(e.sub):'')+'</div>'+
      '</div>'+
    '</div>';
  }).join(''):'<div style="text-align:center;color:var(--text3);padding:24px;font-size:13px;">No activity yet.</div>';
  document.getElementById('girvi-timeline-modal').style.display='block';
}

// ── RENEWAL MODAL ────────────────────────────────────────────────────
function openGirviRenewalModal(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  if(g.status==='closed'){toast('Already closed');return;}
  _grnGirviId=gid;
  // P0-2 hardening: pre-fetch an atomic girvi number the moment the
  // renewal modal opens, same pattern pbToggleForm() uses for purchase
  // bill numbers — so confirmGirviRenewal() can use a server-issued,
  // concurrency-safe number instead of a purely local one.
  _grnPendingGrvNo = null;
  getNextCounter('girvi_no', function(err, val){
    if(typeof val === 'number') _grnPendingGrvNo = val;
  });
  document.getElementById('grn-modal-title').innerHTML='\ud83d\udd04 Renew \u2014 '+escHtml(g.grvNo);
  var outstanding=girviOutstandingWithPenalty(g).amount;
  var penObj=girviOutstandingWithPenalty(g);
  var body=document.getElementById('grn-body');
  body.innerHTML=
    '<div style="background:var(--gold-bg);border:0.5px solid rgba(201,168,76,.25);border-radius:12px;padding:14px;margin-bottom:14px;">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:700;">Current Loan Summary</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">'+
        '<div><span style="color:var(--text3);">Principal:</span> <strong>\u20b9'+Math.round(g.principal).toLocaleString('en-IN')+'</strong></div>'+
        '<div><span style="color:var(--text3);">Interest:</span> <strong style="color:var(--warning);">\u20b9'+Math.round(girviInterestAccrued(g)).toLocaleString('en-IN')+'</strong></div>'+
        (penObj.penalty>0?'<div><span style="color:var(--text3);">Penalty:</span> <strong style="color:var(--danger);">\u20b9'+Math.round(penObj.penalty).toLocaleString('en-IN')+'</strong></div>':'')+
        '<div><span style="color:var(--text3);">Outstanding:</span> <strong style="color:var(--danger);">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</strong></div>'+
      '</div>'+
    '</div>'+
    '<div style="background:var(--success-bg);border:0.5px solid rgba(28,96,64,.2);border-radius:12px;padding:14px;margin-bottom:14px;">'+
      '<div style="font-size:11px;color:var(--success);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:8px;">\ud83d\udd04 New Loan Terms</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'+
        '<div class="ge-fg"><label>New Principal (\u20b9)</label><input id="grn-principal" type="number" value="'+Math.round(outstanding)+'" inputmode="numeric"/></div>'+
        '<div class="ge-fg"><label>Interest Rate</label><input id="grn-rate" type="number" step="0.1" value="'+g.interestRate+'"/></div>'+
        '<div class="ge-fg"><label>Duration (months)</label><input id="grn-duration" type="number" value="'+(g.duration||3)+'" placeholder="3"/></div>'+
        '<div class="ge-fg"><label>Rate Type</label><select id="grn-ratetype"><option value="monthly"'+(g.rateType==='monthly'?' selected':'')+'>%/month</option><option value="yearly"'+(g.rateType==='yearly'?' selected':'')+'>%/year</option></select></div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:8px;">\ud83d\udca1 New GRV number assigned automatically. Items & customer carried forward.</div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;">'+
      '<button class="btn btn-gold" style="flex:2;" onclick="confirmGirviRenewal()">\ud83d\udd04 Confirm Renewal</button>'+
      '<button class="btn" style="flex:1;" onclick="closeGirviRenewalModal()">Cancel</button>'+
    '</div>';
  document.getElementById('girvi-renewal-modal').style.display='block';
}

function closeGirviRenewalModal(){
  document.getElementById('girvi-renewal-modal').style.display='none';
  _grnGirviId=null;
}

function confirmGirviRenewal(){
  var g=_grnGirviId?(S.girvi||[]).find(function(x){return x.id===_grnGirviId;}):null;
  if(!g){toast('Not found');return;}
  if(_girviLocked(g.id)){ toast('Renewal already being processed — please wait'); return; }
  var newPrincipal=parseFloat((document.getElementById('grn-principal')||{}).value);
  var newRate=parseFloat((document.getElementById('grn-rate')||{}).value);
  var newDuration=parseInt((document.getElementById('grn-duration')||{}).value)||0;
  var newRateType=((document.getElementById('grn-ratetype')||{}).value)||'monthly';
  if(!newPrincipal||newPrincipal<=0){toast('\u26a0 Enter new principal');return;}
  if(!newRate||newRate<=0){toast('\u26a0 Enter new interest rate');return;}

  var ts=new Date().toISOString();
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  var _oldSnap = _girviSnapshot(g.id);
  _girviLock(g.id);

  // Close current
  g.status='closed'; g.closedAt=ts;
  if(!g.ledger)g.ledger=[];
  g.ledger.push({type:'renewal',note:'Renewed \u2192 new principal \u20b9'+Math.round(newPrincipal).toLocaleString('en-IN'),ts:ts,user:currentUser});

  // Create new entry. Use the atomic counter fetched when the modal
  // opened when it resolved in time; otherwise fall back to the local
  // sequential counter — same fallback contract every other counter in
  // the app uses when store-proxy is unreachable (see pbToggleForm /
  // savePurchase in 09-purchases.js for the pattern this mirrors).
  var newSeq=(typeof _grnPendingGrvNo==='number')?_grnPendingGrvNo:(S.nextGirviId||((S.girvi||[]).length+1));
  var grvNo='GRV-'+String(newSeq).padStart(4,'0');
  if(newSeq>=S.nextGirviId) S.nextGirviId=newSeq+1;
  _grnPendingGrvNo=null;
  var newG=JSON.parse(JSON.stringify(g));
  newG.id=(typeof crypto.randomUUID==='function')?crypto.randomUUID():(Date.now().toString(36)+Math.random().toString(36).slice(2));
  newG._seq=newSeq;
  newG.grvNo=grvNo;
  newG.createdAt=ts;
  newG.startDate=ts.slice(0,10);
  newG.principal=Math.round(newPrincipal);
  newG.interestRate=newRate;
  newG.rateType=newRateType;
  newG.duration=newDuration;
  newG.status='active';
  newG.payments=[];
  newG.closedAt=null;
  newG.renewedFrom=g.grvNo;
  newG.ledger=[{type:'created',note:'Renewal of '+g.grvNo+'. Principal: \u20b9'+Math.round(newPrincipal).toLocaleString('en-IN'),ts:ts,user:currentUser}];

  S.girvi.push(newG);

  if(typeof auditLog==='function') auditLog('create','girvi',newG.id,'Renewal from '+g.grvNo);
  if(typeof saasActivityLog==='function') saasActivityLog('girvi',g.grvNo+' renewed as '+grvNo);

  closeGirviRenewalModal();
  if(typeof closeGirviDetail==='function') closeGirviDetail();
  // Foundation audit B2: renewal is a two-record transaction (close the
  // old loan + push a brand-new one) — "Renewed locally" previously left
  // BOTH halves permanently applied in this tab on a failed/conflicted
  // save, with the new loan existing nowhere but this browser. Rollback
  // now restores the old loan's snapshot AND removes the new loan record
  // together, so a failed renewal leaves zero trace, matching how a
  // failed sale already rolls back cleanly.
  _girviCommit(g.id, {snapshot:_oldSnap, newIds:[newG.id]}, function(err){
    if(err) return;
    renderGirvi(); renderDash();
    toast('\u2705 Girvi renewed as '+grvNo+'!');
  });
}

// ── RECEIPT MODAL ────────────────────────────────────────────────────
function openGirviReceiptModal(gid, receiptType){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  receiptType=receiptType||'creation';
  var titles={creation:'\ud83e\uddfe Loan Receipt',payment:'\ud83e\uddfe Payment Receipt',renewal:'\ud83e\uddfe Renewal Receipt',release:'\ud83e\uddfe Release Receipt'};
  var title=titles[receiptType]||'\ud83e\uddfe Receipt';
  var titleEl=document.getElementById('grr-modal-title');
  titleEl.innerHTML=title;
  titleEl.dataset.gid=gid;
  titleEl.dataset.receiptType=receiptType;

  var shopName=(typeof SAAS!=='undefined'&&SAAS.shop&&SAAS.shop.name)||'Sri Sai Jewellers';
  var shopPhone=(typeof SAAS!=='undefined'&&SAAS.shop&&SAAS.shop.phone)||'';
  var shopCity=(typeof SAAS!=='undefined'&&SAAS.shop&&SAAS.shop.city)||'';
  var ledger=girviLedgerState(g);
  var outstanding=ledger.outstanding;
  var _allIt=Array.isArray(g.items)&&g.items.length?g.items:(g.item?[g.item]:[]);
  var dueDate='';
  if(g.startDate&&g.duration){
    var dd=new Date(g.startDate); dd.setMonth(dd.getMonth()+(parseInt(g.duration)||0));
    dueDate=fmtDate(dbDayKey(dd));
  }

  // The most recent real payment (used for the customer-facing headline
  // when this receipt is being generated right after a payment)
  var realPayments=ledger.payments.filter(function(p){return p.type!=='penalty'&&p.type!=='refund';});
  var lastPay=realPayments.length?realPayments[realPayments.length-1]:null;

  // ── Customer-facing headline: no interest math, just three numbers ──
  var prevOutstanding = lastPay ? outstanding + (lastPay.interestPortion||0) + (lastPay.principalPortion||0) : outstanding;
  var customerHeadline =
    '<div style="background:var(--gold-bg);border:0.5px solid rgba(201,168,76,.3);border-radius:8px;padding:10px 12px;margin-bottom:12px;">'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;font-size:12px;">'+
        '<div><div style="color:var(--text3);text-transform:uppercase;font-size:9px;font-family:Inter,sans-serif;">Outstanding Before</div><strong>\u20b9'+Math.round(prevOutstanding).toLocaleString('en-IN')+'</strong></div>'+
        (lastPay?'<div><div style="color:var(--text3);text-transform:uppercase;font-size:9px;font-family:Inter,sans-serif;">Amount Received</div><strong style="color:var(--success);">\u20b9'+Math.round(lastPay.amount).toLocaleString('en-IN')+'</strong></div>':'<div></div>')+
        '<div><div style="color:var(--text3);text-transform:uppercase;font-size:9px;font-family:Inter,sans-serif;">Balance Remaining</div><strong style="color:var(--gold-dark);">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</strong></div>'+
      '</div>'+
    '</div>';

  // ── Payment history table — every payment, and how the balance moved ──
  var runningBal = g.principal;
  var histRows = ledger.payments.map(function(p){
    // Recompute the balance AFTER this entry for the running column
    if(p.type==='penalty'||p.type==='refund'){ /* increases owed, handled via principalPortion sign */ }
    runningBal = runningBal - (p.principalPortion||0);
    return '<tr>'+
      '<td>'+fmtDate(p.date||p.ts)+'</td>'+
      '<td>\u20b9'+Math.round(p.amount||0).toLocaleString('en-IN')+'</td>'+
      '<td>\u20b9'+Math.round(p.interestPortion||0).toLocaleString('en-IN')+'</td>'+
      '<td>\u20b9'+Math.round(p.principalPortion||0).toLocaleString('en-IN')+'</td>'+
      '<td>\u20b9'+Math.round(Math.max(0,runningBal)).toLocaleString('en-IN')+'</td>'+
    '</tr>';
  }).join('');
  var historyHtml = ledger.payments.length
    ? '<div class="tbl-wrap" style="margin-top:8px;"><table style="font-size:11px;"><thead><tr>'+
        '<th>Date</th><th>Paid</th><th>Interest</th><th>Principal</th><th>Balance</th>'+
      '</tr></thead><tbody>'+histRows+'</tbody></table></div>'
    : '<div style="font-size:12px;color:var(--text3);padding:6px 0;">No payments recorded yet.</div>';

  var body=document.getElementById('grr-body');
  body.innerHTML=
    '<div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;font-family:\'Cormorant Garamond\',Georgia,serif;">'+
      '<div style="text-align:center;border-bottom:2px solid var(--gold);padding-bottom:12px;margin-bottom:12px;">'+
        '<div style="font-size:22px;font-weight:700;color:var(--gold-dark);letter-spacing:.06em;">'+escHtml(shopName)+'</div>'+
        (shopCity?'<div style="font-size:12px;color:var(--text3);">'+escHtml(shopCity)+'</div>':'')+
        (shopPhone?'<div style="font-size:12px;color:var(--text3);">\ud83d\udcde '+escHtml(shopPhone)+'</div>':'')+
        '<div style="font-size:13px;font-weight:700;color:var(--ink);margin-top:8px;text-transform:uppercase;letter-spacing:.1em;">'+title+'</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;margin-bottom:12px;">'+
        '<div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-family:Inter,sans-serif;">Girvi No.</div><strong>'+g.grvNo+'</strong></div>'+
        '<div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-family:Inter,sans-serif;">Date</div><strong>'+fmtDate(new Date().toISOString())+'</strong></div>'+
        '<div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-family:Inter,sans-serif;">Customer</div><strong>'+escHtml(g.customer)+'</strong></div>'+
        '<div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-family:Inter,sans-serif;">Mobile</div><strong>'+escHtml(g.phone)+'</strong></div>'+
        (g.address?'<div style="grid-column:1/-1;"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-family:Inter,sans-serif;">Address</div>'+escHtml(g.address)+'</div>':'')+
      '</div>'+
      customerHeadline+
      '<div style="border:0.5px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px;">'+
        '<div style="background:var(--gold-dark);color:#fff;padding:7px 10px;font-family:Inter,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Pledged Items</div>'+
        _allIt.map(function(it,n){
          return '<div style="padding:8px 10px;border-bottom:0.5px solid var(--border);font-size:13px;">'+
            '<strong>'+(n+1)+'. '+escHtml(it.desc||it.type||'Item')+'</strong><br>'+
            '<span style="font-size:11px;color:var(--text3);">'+it.purity+' '+it.metal+' \u2022 Gross: '+(it.weight||it.grossWt||0)+'g'+(it.qty>1?' \u2022 Qty: '+it.qty:'')+'</span>'+
          '</div>';
        }).join('')+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:2px solid var(--gold);">'+
        '<span style="font-size:14px;font-weight:700;">Final Outstanding:</span>'+
        '<span style="font-size:20px;font-weight:700;color:var(--gold-dark);">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</span>'+
      '</div>'+
      '<details style="margin-top:12px;font-family:Inter,sans-serif;">'+
        '<summary style="cursor:pointer;font-size:11px;font-weight:600;color:var(--text3);">Owner detail \u2014 full payment history &amp; interest breakup</summary>'+
        '<div style="margin-top:8px;font-family:Inter,sans-serif;font-size:11px;">'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px;">'+
            '<div>Loan Amount: <strong>\u20b9'+Math.round(g.principal).toLocaleString('en-IN')+'</strong></div>'+
            '<div>Rate: <strong>'+g.interestRate+'% '+(g.rateType==='yearly'?'/yr':'/mo')+'</strong></div>'+
            '<div>Start: '+fmtDate(g.startDate)+'</div>'+
            (dueDate?'<div>Due: <strong style="color:var(--danger);">'+dueDate+'</strong></div>':'')+
            '<div>Interest Paid So Far: <strong>\u20b9'+Math.round(ledger.totalInterestPaid).toLocaleString('en-IN')+'</strong></div>'+
            '<div>Principal Paid So Far: <strong>\u20b9'+Math.round(ledger.totalPrincipalPaid).toLocaleString('en-IN')+'</strong></div>'+
          '</div>'+
          historyHtml+
        '</div>'+
      '</details>'+
      (g.notes?'<div style="font-size:11px;color:var(--text3);margin-top:8px;font-style:italic;">Note: '+escHtml(g.notes)+'</div>':'')+
      '<div style="text-align:center;margin-top:16px;padding-top:12px;border-top:0.5px solid var(--border);font-size:10px;color:var(--text3);">Powered by JewelOS \u2022 Computer-generated receipt</div>'+
    '</div>';

  document.getElementById('girvi-receipt-modal').style.display='block';
}

function printGirviReceipt(){
  var body=document.getElementById('grr-body');
  if(!body) return;
  var w=window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Girvi Receipt</title>'+
    '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&display=swap" rel="stylesheet">'+
    '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;background:#fff;padding:20px;font-size:12px;}@media print{body{padding:0;}}</style>'+
    '</head><body>'+body.innerHTML+'</body></html>');
  w.document.close(); w.focus();
  setTimeout(function(){w.print();},400);
}

// Loads html2canvas from CDN on first use only (not on page load) so the
// receipt can be turned into a shareable image.
var _h2cLoading=null;
function _loadHtml2Canvas(cb){
  if(typeof html2canvas!=='undefined'){ cb(); return; }
  if(_h2cLoading){ _h2cLoading.push(cb); return; }
  _h2cLoading=[cb];
  var s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  s.onload=function(){ var cbs=_h2cLoading; _h2cLoading=null; cbs.forEach(function(f){f();}); };
  s.onerror=function(){ toast('\u26a0 Could not load image generator — check your internet connection'); _h2cLoading=null; };
  document.head.appendChild(s);
}

function _girviReceiptWaMessage(g, ledger){
  var shopName=(typeof SAAS!=='undefined'&&SAAS.shop&&SAAS.shop.name)||'hamari dukaan';
  var realPayments=ledger.payments.filter(function(p){return p.type!=='penalty'&&p.type!=='refund';});
  var lastPay=realPayments.length?realPayments[realPayments.length-1]:null;
  var outstanding=Math.round(ledger.outstanding).toLocaleString('en-IN');
  if(lastPay){
    return 'Namaste '+g.customer+' ji \ud83d\ude4f\n\n'+
      'Aapka payment mil gaya hai, dhanyavaad!\n\n'+
      'Girvi No: *'+g.grvNo+'*\n'+
      'Amount Received: *\u20b9'+Math.round(lastPay.amount).toLocaleString('en-IN')+'*\n'+
      'Remaining Loan: *\u20b9'+outstanding+'*\n\n'+
      '_'+shopName+'_';
  }
  return 'Namaste '+g.customer+' ji \ud83d\ude4f\n\n'+
    '*'+shopName+'* mein aapka girvi loan record:\n\n'+
    'Girvi No: *'+g.grvNo+'*\n'+
    'Outstanding: *\u20b9'+outstanding+'*\n\n'+
    '_'+shopName+'_';
}

function shareGirviReceiptWA(){
  var titleEl=document.getElementById('grr-modal-title');
  var gid=titleEl&&titleEl.dataset.gid;
  var g=gid&&(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  var ledger=girviLedgerState(g);
  var msg=_girviReceiptWaMessage(g, ledger);
  var phone=(g.phone||'').replace(/\D/g,'');
  if(phone.length===10) phone='91'+phone;

  var body=document.getElementById('grr-body');
  if(!body){ window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank'); return; }

  toast('Preparing receipt image\u2026');
  _loadHtml2Canvas(function(){
    if(typeof html2canvas==='undefined'){
      // Library failed to load — still get the text through
      window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
      return;
    }
    html2canvas(body,{backgroundColor:'#ffffff',scale:2}).then(function(canvas){
      canvas.toBlob(function(blob){
        if(!blob){ window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank'); return; }
        var file=new File([blob],'girvi-receipt-'+g.grvNo+'.png',{type:'image/png'});
        // Native share sheet can hand BOTH the image and the text to
        // WhatsApp in one tap — this is the only web-platform path that
        // actually attaches a file, since wa.me links can't carry one.
        if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
          navigator.share({files:[file], text:msg, title:'Girvi Receipt '+g.grvNo}).catch(function(){});
        } else {
          // Fallback: download the image for manual attach, open WhatsApp
          // with the text pre-filled.
          var a=document.createElement('a');
          a.href=URL.createObjectURL(blob);
          a.download='girvi-receipt-'+g.grvNo+'.png';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          toast('Receipt image downloaded — attach it in WhatsApp');
          window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
        }
      },'image/png');
    }).catch(function(){
      window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
    });
  });
}

// ── v20 extended actions — folded into openGirviDetail ───────────────
// This used to override openGirviDetail, call the original, then append a
// second action panel 80ms later. That panel repeated Edit, Renew and
// WhatsApp, all of which openGirviDetail already renders, so opening any
// loan showed each of those three twice. Ledger, Timeline and Receipt were
// the only actions unique to it; they now sit with the rest of the buttons
// in openGirviDetail (07-settings-plans.js) and the override is removed.

// ── LIVE INPUT WIRING ────────────────────────────────────────────────
document.addEventListener('input',function(e){
  var id=e.target&&e.target.id;
  if(['ge-principal','ge-rate','ge-duration','ge-startdate'].indexOf(id)>-1) geUpdateDueDate();
  if(id==='gl-amount') glUpdateBalance();
});
document.addEventListener('change',function(e){
  var id=e.target&&e.target.id;
  if(['ge-startdate','ge-duration','ge-ratetype','ge-compound'].indexOf(id)>-1) geUpdateDueDate();
  if(id==='gl-mode'||id==='girvi-filter-status'||id==='girvi-filter-metal') resetGirviPage();
});

// ── GIRVI v20 MODAL BACKDROP CLOSE ──────────────────────────────────
['girvi-edit-modal','girvi-ledger-modal','girvi-timeline-modal','girvi-renewal-modal','girvi-receipt-modal'].forEach(function(id){
  var el=document.getElementById(id);
  if(!el) return;
  el.addEventListener('click',function(e){
    if(e.target===el) el.style.display='none';
  });
});

// ═══ END GIRVI MODULE v20 ═══


// ===================================================================
// --- AUDIT LOG RENDERER --------------------------------------------
// ===================================================================
function renderAuditLog() {
  var el = document.getElementById('audit-log-list');
  if(!el) return;
  var log = getAuditLog(200);
  if(!log.length){
    el.innerHTML='<div style="text-align:center;color:var(--text3);padding:24px;">No audit entries yet. Start using the app and all actions will be logged here.</div>';
    return;
  }
  var actionColors = {
    create: '#1c6040', update: '#1a4a8a', delete: '#a8312a',
    refund: '#8a4e0c', print: '#5c5244', export: '#5c5244',
    login: '#1c6040', payment: '#1c6040'
  };
  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
    '<thead><tr style="border-bottom:2px solid var(--border2);">' +
      '<th style="text-align:left;padding:7px 8px;color:var(--text3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">Time</th>' +
      '<th style="text-align:left;padding:7px 8px;color:var(--text3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">User</th>' +
      '<th style="text-align:left;padding:7px 8px;color:var(--text3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">Action</th>' +
      '<th style="text-align:left;padding:7px 8px;color:var(--text3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">Entity</th>' +
      '<th style="text-align:left;padding:7px 8px;color:var(--text3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.08em;">Details</th>' +
    '</tr></thead><tbody>';
  log.forEach(function(e, idx) {
    var color = actionColors[e.action] || '#5c5244';
    var dt = '';
    try { 
      var d = new Date(e.ts);
      dt = d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}) + ' ' + 
           d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    } catch(ex) { dt = e.ts; }
    html += '<tr style="border-bottom:0.5px solid var(--border);'+(idx%2?'background:var(--bg);':'')+'">'+
      '<td style="padding:6px 8px;color:var(--text3);white-space:nowrap;">'+escHtml(dt)+'</td>'+
      '<td style="padding:6px 8px;font-weight:600;color:var(--ink2);">'+escHtml(e.user||'-')+'<br><span style="font-size:10px;color:var(--text3);">'+escHtml(e.role||'')+'</span></td>'+
      '<td style="padding:6px 8px;"><span style="background:'+color+'22;color:'+color+';padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700;text-transform:uppercase;">'+escHtml(e.action||'-')+'</span></td>'+
      '<td style="padding:6px 8px;color:var(--ink3);">'+escHtml(e.entity||'-')+'<br><span style="font-size:10px;color:var(--text3);">'+escHtml(e.entityId||'')+'</span></td>'+
      '<td style="padding:6px 8px;color:var(--ink3);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+escHtml(e.note||'')+'">'+escHtml(e.note||'-')+'</td>'+
    '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function showAuditSubtab(sub){
  var isTrail = sub==='trail';
  document.getElementById('audit-subtab-trail').style.display = isTrail ? '' : 'none';
  document.getElementById('audit-subtab-activity').style.display = isTrail ? 'none' : '';
  document.getElementById('audit-subtab-trail-btn').className = 'btn btn-sm' + (isTrail?' btn-gold':'');
  document.getElementById('audit-subtab-activity-btn').className = 'btn btn-sm' + (isTrail?'':' btn-gold');
  if(!isTrail) renderActivityLogGrouped();
}

// Groups S.activityLog by user, showing each user's most recent login
// time as a header with their subsequent actions listed chronologically
// underneath — instead of one flat mixed-together timeline where it's
// hard to tell who did what. Login entries themselves (type:'auth',
// logged by saasActivityLog() on every successful sign-in) become that
// user's section header rather than just another row in the list.
function renderActivityLogGrouped(){
  var el = document.getElementById('activity-log-grouped');
  if(!el) return;
  var roleFilter = (document.getElementById('activity-role-filter')||{}).value || 'all';
  var log = Array.isArray(S.activityLog) ? S.activityLog : [];
  if(roleFilter!=='all') log = log.filter(function(e){ return e.role===roleFilter; });

  if(!log.length){
    el.innerHTML = '<div style="text-align:center;color:var(--text3);padding:24px;">No activity recorded yet.</div>';
    return;
  }

  // Group by user name, oldest-first within each group so the timeline
  // reads top-to-bottom the way it happened.
  var byUser = {};
  var order = []; // preserves first-seen order = most-recently-active user first, since log is newest-first
  log.forEach(function(e){
    var u = e.user || 'Unknown';
    if(!byUser[u]){ byUser[u]=[]; order.push(u); }
    byUser[u].push(e);
  });

  function fmtTime(ts){
    try{
      var d = new Date(ts);
      return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    }catch(ex){ return ts||''; }
  }

  var html = '';
  order.forEach(function(user){
    var entries = byUser[user].slice().reverse(); // oldest-first for display
    var loginEntry = entries.filter(function(e){ return e.type==='auth' && /signed in/i.test(e.note||''); }).pop();
    var role = entries.length ? (entries[entries.length-1].role||'') : '';
    html += '<div style="margin-bottom:18px;border:0.5px solid var(--border2);border-radius:10px;overflow:hidden;">';
    html += '<div style="background:var(--gold-bg);padding:8px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">';
    html += '<div><strong style="color:var(--ink);">'+escHtml(user)+'</strong>'+(role?' <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">'+escHtml(role)+'</span>':'')+'</div>';
    html += '<div style="font-size:11px;color:var(--text3);">Login: '+(loginEntry?escHtml(fmtTime(loginEntry.ts)):'—')+'</div>';
    html += '</div>';
    html += '<div>';
    entries.forEach(function(e, idx){
      if(e===loginEntry) return; // already shown as the header
      html += '<div style="padding:6px 12px;font-size:12px;'+(idx%2?'background:var(--bg);':'')+'border-top:0.5px solid var(--border);">';
      html += '<span style="color:var(--text3);">'+escHtml(fmtTime(e.ts))+'</span> — '+escHtml(e.note||e.type||'');
      html += '</div>';
    });
    html += '</div></div>';
  });
  el.innerHTML = html;
}


// ===================================================================
// --- V18 WHAT'S NEW MODAL ------------------------------------------
// ===================================================================
function showV18Changelog(){
  var overlay = document.createElement("div");
  overlay.id = "v18-modal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;";

  var features = [
    { icon:"&#127959;", title:"GST Engine", desc:"HSN codes, CGST/SGST/IGST auto-split on Tax Invoices" },
    { icon:"&#128260;", title:"Refund & Credit Notes", desc:"Issue partial or full refunds with reason tracking" },
    { icon:"&#127991;", title:"Barcode Label Printing", desc:"Print A4 label sheets — click Labels in Inventory" },
    { icon:"&#128203;", title:"Audit Log", desc:"Every action logged — Settings &#8594; Audit" },
    { icon:"&#128178;", title:"Compound Interest Fix", desc:"Girvi penalty on outstanding balance + risk scoring" },
    { icon:"&#9729;",   title:"Cloud Sync Fixed", desc:"Per-shop keys, upsert fallback, offline recovery" },
    { icon:"&#128196;", title:"Inventory Pagination", desc:"50 items per page for large catalogues" },
  ];

  var rows = features.map(function(f){
    return "<div style=\"display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:0.5px solid var(--border);\">"
      + "<span style=\"font-size:22px;flex-shrink:0;\">" + f.icon + "</span>"
      + "<div><div style=\"font-size:13px;font-weight:700;color:var(--ink);margin-bottom:2px;\">" + f.title + "</div>"
      + "<div style=\"font-size:12px;color:var(--text3);line-height:1.5;\">" + f.desc + "</div></div>"
      + "</div>";
  }).join("");

  overlay.innerHTML =
    "<div style=\"background:var(--surface);border-radius:20px;max-width:480px;width:100%;max-height:88vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.4);\">"
    + "<div style=\"padding:22px 22px 0;\">"
      + "<div style=\"display:flex;align-items:center;gap:10px;margin-bottom:6px;\">"
        + "<span style=\"font-size:28px;\">&#128081;</span>"
        + "<div>"
          + "<div style=\"font-size:22px;font-weight:700;color:var(--ink);\">JewelOS v18.1</div>"
          + "<div style=\"font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;\">What&#39;s New &middot; Production Build</div>"
        + "</div>"
      + "</div>"
      + "<div style=\"background:var(--gold-bg);border:1px solid var(--border-gold);border-radius:10px;padding:10px 14px;margin:10px 0;font-size:12px;color:var(--gold-dark);font-weight:600;\">"
        + "&#128272; Run SQL setup in Settings &#8594; Data &#8594; Cloud Setup before sharing with staff."
      + "</div>"
    + "</div>"
    + "<div style=\"padding:0 22px;\">" + rows + "</div>"
    + "<div style=\"padding:16px 22px;\">"
      + "<button onclick=\"document.getElementById('v18-modal').remove()\" style=\"width:100%;padding:13px;background:var(--gold);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;\">Got it &#8212; Let's Go &#127775;</button>"
    + "</div>"
    + "</div>";

  document.body.appendChild(overlay);
  overlay.addEventListener("click", function(e){ if(e.target===overlay) overlay.remove(); });
}


// ===================================================================
// --- CLOUD DIAGNOSTICS (P0 hardening pass, Aug 2026) ---------------
// ===================================================================
// Run from browser console: cloudDiag()
// Or accessible via Settings → About → Run Cloud Diagnostics
//
// P0-5 fix: this used to GET the `store` table directly via SB_REST
// with the public anon key. Since 001_lockdown_rls.sql revokes all
// anon/authenticated access to that table, that call now ALWAYS fails
// — the diagnostic would report "Cloud connection FAILED" even when
// the app is syncing perfectly fine through store-proxy, which is the
// only path that still works. It now tests the actual production
// architecture (store-proxy + auth-gateway) instead of a path that no
// longer exists for the browser.
function cloudDiag(silent){
  var log = [];
  var shopKey = _getShopRowKey();
  log.push("JewelOS Cloud Diagnostics");
  log.push("================================");
  log.push("Shop key       : " + shopKey);
  log.push("SHOP_ROW_KEY   : " + (typeof SHOP_ROW_KEY !== "undefined" ? SHOP_ROW_KEY : "NOT SET"));
  log.push("isSaving       : " + (typeof isSaving !== "undefined" ? isSaving : "N/A"));
  var ls = window._lastSyncStatus;
  log.push("Last sync      : " + (ls ? ls.status + " — " + ls.label + " (" + Math.round((Date.now()-ls.ts)/1000) + "s ago)" : "none"));
  log.push("Online         : " + navigator.onLine);
  log.push("localStorage   : " + (function(){ try{ localStorage.setItem("_t","1");localStorage.removeItem("_t");return "OK"; }catch(e){return "BLOCKED: "+e.message;} })());
  log.push("SAAS.user      : " + (SAAS && SAAS.user ? SAAS.user.email : "not set"));
  log.push("SAAS.shop      : " + (SAAS && SAAS.shop ? SAAS.shop.name + " (id:" + SAAS.shop.id + ")" : "not set"));
  log.push("");
  log.push("Testing store-proxy (data sync)...");

  if(!silent) console.log(log.join("\n"));

  function renderModal(){
    if(silent) return;
    console.log(log.join("\n"));
    var d = document.createElement("div");
    d.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
    d.innerHTML = "<div style=\"background:#1a1a1a;color:#e2e8f0;border-radius:14px;padding:20px;max-width:540px;width:100%;font-family:monospace;font-size:12px;line-height:1.7;max-height:80vh;overflow-y:auto;\">"
      + "<div style=\"font-size:14px;font-weight:700;color:#f9a825;margin-bottom:12px;\">&#128269; Cloud Diagnostics</div>"
      + "<pre style=\"white-space:pre-wrap;margin:0;\">" + escHtml(log.join("\n")) + "</pre>"
      + "<div style=\"margin-top:14px;display:flex;gap:8px;\">"
        + "<button onclick=\"this.closest('.diag-wrap').remove()\" style=\"padding:8px 18px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;\">Close</button>"
        + "<button onclick=\"isSaving=false;setSyncStatus('ok','Lock reset');toast('isSaving reset');this.closest('.diag-wrap').remove()\" style=\"padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;\">Reset Save Lock</button>"
      + "</div>"
      + "</div>";
    d.className = "diag-wrap";
    document.body.appendChild(d);
    d.addEventListener("click", function(e){ if(e.target===d) d.remove(); });
  }

  // Cloud health check: browser → store-proxy. A reachable proxy that
  // returns 200 (row found or null-for-new-shop) means the real
  // production sync path is healthy — regardless of whether the old
  // direct-REST path would have worked.
  // The proxy stopped trusting x-shop-key in the v5 (session-token) deploy —
  // it derives shop + role from the signed session token instead. This
  // diagnostic was still sending the old header, so it reported "shop key
  // rejected" on every healthy install. Send what the app actually sends.
  var storeOk = true, authOk = true, storeStatus = 0;
  var storeCheck = fetch(SB_FUNCTIONS + "/store-proxy", {
    method: "GET",
    headers: Object.assign({}, SB_HEADERS, { "x-session-token": (typeof SAAS!=='undefined' && SAAS.sessionToken) || '' })
  })
  .then(function(r){
    return r.json().then(function(body){ return { status: r.status, body: body }; })
      .catch(function(){ return { status: r.status, body: null }; });
  })
  .then(function(res){
    storeStatus = res.status;
    if(res.status === 200){
      var hasRow = res.body && res.body.data;
      log.push("store-proxy    : reachable — HTTP 200 (" + (hasRow ? "shop data found" : "no row yet — will be created on first save") + ")");
    } else if(res.status === 401){
      log.push("store-proxy    : reachable — HTTP 401 (session token rejected or expired — log out and back in)");
    } else {
      log.push("store-proxy    : reachable — HTTP " + res.status + (res.body && res.body.error ? " (" + res.body.error + ")" : ""));
    }
  })
  .catch(function(err){
    storeOk = false;
    log.push("store-proxy    : UNREACHABLE — " + err.message);
  });

  // Authentication health check: browser → auth-gateway.
  // Second time this diagnostic has reported a healthy install as broken by
  // not sending what the real code path sends (see the x-shop-key note
  // above). This probe used to send SB_HEADERS, which carries Prefer — a
  // PostgREST header that auth-gateway's Access-Control-Allow-Headers does
  // not list, so the browser failed the preflight and fetch rejected with
  // "Failed to fetch" on a gateway that was serving logins perfectly.
  // store-proxy does allow prefer, which is why only this check was hit.
  // Now it sends exactly what authGatewayCall() sends. The route is one that
  // does not exist on purpose: auth-gateway answers an unknown route with a
  // 404 and no side effects, which proves it is deployed and reachable
  // without spending a real login or password-reset attempt.
  var authCheck = fetch(SB_FUNCTIONS + "/auth-gateway/_diag-ping", {
    method: "POST",
    headers: {'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY},
    body: "{}"
  })
  .then(function(r){
    log.push("auth-gateway   : reachable — HTTP " + r.status + (r.status===404 ? " (expected for the probe route)" : ""));
  })
  .catch(function(err){
    authOk = false;
    log.push("auth-gateway   : UNREACHABLE — " + err.message);
  });

  return Promise.all([storeCheck, authCheck]).then(function(){
    log.push("");
    // Derive this from the checks that just ran. It used to consult only the
    // store-proxy result, so it announced "Authentication: Healthy" two lines
    // under "auth-gateway: UNREACHABLE" — a diagnostic that contradicts itself
    // is worse than none, because it sends you looking in the wrong place.
    // Read the flags the checks set, not the log text they printed.
    if(!storeOk || !authOk){
      var down = [];
      if(!storeOk) down.push("data sync");
      if(!authOk)  down.push("sign-in");
      log.push("Cloud unavailable — " + down.join(" and ") + " could not be reached.");
      log.push("Your local data is safe. Retry when the connection is restored.");
      if(!silent) toast("\u26a0 Cloud unavailable — your local data is safe.");
    } else if(storeStatus !== 200){
      log.push("Cloud status: Connected, but data sync answered HTTP " + storeStatus + ".");
      log.push("Authentication: Healthy. See the store-proxy line above for what to do.");
    } else {
      log.push("Cloud status: Connected. Sync: Healthy. Authentication: Healthy.");
    }
    renderModal();
    return log;
  });
}

// Emergency: reset the isSaving lock if it gets stuck
function resetSaveLock(){
  isSaving = false;
  _isSavingSetAt = 0;
  setSyncStatus('ok', 'Lock reset');
  toast('\u2705 Save lock reset.');
  setTimeout(function(){ saveCache(); saveToCloud(function(err){ if(!err) toast('\u2705 Data synced successfully'); }); }, 300);
}


// ===================================================================
// ─── CENTRALIZED ERROR HANDLER & CONNECTIVITY MONITOR (v18) ───────
// ===================================================================

// Global error catcher — prevents silent JS crashes
window.addEventListener('error', function(e){
  console.error('[JewelOS] Uncaught error:', e.message, 'at', e.filename, e.lineno);
  // Don't toast every error — only critical ones
  if(e.message && (e.message.indexOf('Cannot read') > -1 || e.message.indexOf('is not a function') > -1)){
    console.warn('[JewelOS] Possible null reference:', e.message);
  }
});

window.addEventListener('unhandledrejection', function(e){
  console.error('[JewelOS] Unhandled promise rejection:', e.reason);
  // Prevent "Uncaught in promise" console spam
  e.preventDefault();
});

// ── Online/Offline detection ────────────────────────────────────────
var _wasOffline = false;
window.addEventListener('offline', function(){
  _wasOffline = true;
  setSyncStatus('err', 'Offline');
  console.warn('[JewelOS] Network offline');
});

window.addEventListener('online', function(){
  if(_wasOffline){
    _wasOffline = false;
    console.log('[JewelOS] Network restored — syncing');
    setSyncStatus('syncing', 'Reconnecting...');
    // Small delay to let connection stabilize
    setTimeout(function(){
      if((typeof isPinSessionActive === 'function' && isPinSessionActive())){
        loadFromCloud(function(err){
          if(!err){
            saveCache();
            _lastCloudHash = '';  // force re-render
            var activeTab = document.querySelector('.panel.active');
            if(activeTab){ renderTab(activeTab.id.replace('panel-','')); }
            setSyncStatus('ok', 'Live ●');
            toast('✓ Back online — data synced');
          }
        });
      }
    }, 1500);
  }
});

// ── Page Visibility API — sync when tab becomes active ──────────────
document.addEventListener('visibilitychange', function(){
  if(!document.hidden && !_wasOffline && !isSaving){
    // Tab became visible again — check if data is stale (>2 min)
    var lastSave = parseInt(localStorage.getItem('ssj_last_save') || '0');
    if(Date.now() - lastSave > 120000){
      if((typeof isPinSessionActive === 'function' && isPinSessionActive())){
        loadFromCloud(function(err){
          if(!err){ saveCache(); }
        });
      }
    }
  }
});


// ── SERVICE WORKER — OFFLINE SUPPORT ─────────────────────────────────
(function registerServiceWorker(){
  // Online/offline detection using existing error banner
  function _updateOnlineStatus(){
    var banner = document.getElementById('save-error-banner');
    var spanEl = banner ? banner.querySelector('span') : null;
    if(!navigator.onLine){
      if(banner && spanEl){
        spanEl.textContent = '\u26a0 Offline \u2014 showing cached data. Changes will sync when reconnected.';
        banner.style.display = 'flex';
      }
    } else {
      if(banner && spanEl && (spanEl.textContent||'').indexOf('Offline') > -1){
        banner.style.display = 'none';
        if(typeof toast==='function') toast('\u2705 Back online \u2014 syncing...');
        if(typeof forceSync==='function') setTimeout(forceSync, 1000);
      }
    }
  }
  window.addEventListener('online',  _updateOnlineStatus);
  window.addEventListener('offline', _updateOnlineStatus);

  // Service Worker — only on HTTPS (required by browser security)
  if(!('serviceWorker' in navigator)) return;
  if(location.protocol !== 'https:' && location.hostname !== 'localhost'){
    console.log('[JewelOS] SW skipped: requires HTTPS');
    return;
  }

  // SW code as array of strings (avoids template literal / HTML parser conflicts)
  var swCode = [
    "var CACHE='jewelos-v19';",
    "self.addEventListener('install',function(e){self.skipWaiting();});",
    "self.addEventListener('activate',function(e){",
    "  e.waitUntil(caches.keys().then(function(k){",
    "    return Promise.all(k.filter(function(n){return n!==CACHE;}).map(function(n){return caches.delete(n);}));",
    "  }).then(function(){return self.clients.claim();}));",
    "});",
    "self.addEventListener('fetch',function(e){",
    "  if(e.request.method!=='GET')return;",
    "  var u=e.request.url;",
    "  if(u.indexOf('supabase.co')>-1||u.indexOf('razorpay')>-1)return;",
    "  e.respondWith(fetch(e.request).then(function(r){",
    "    if(r&&r.status===200){var c=r.clone();caches.open(CACHE).then(function(ca){ca.put(e.request,c);});}",
    "    return r;",
    "  }).catch(function(){return caches.match(e.request);}));",
    "});"
  ].join('\n');

  try{
    var swBlob = new Blob([swCode], {type:'application/javascript'});
    var swUrl  = URL.createObjectURL(swBlob);
    navigator.serviceWorker.register(swUrl).then(function(){
      console.log('[JewelOS] Service Worker active');
    }).catch(function(e){
      console.warn('[JewelOS] SW registration failed:',e.message);
    });
  }catch(e){
    console.warn('[JewelOS] SW init error:',e.message);
  }
})();


