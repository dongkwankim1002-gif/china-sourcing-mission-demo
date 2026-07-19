(() => {
  const DATA = window.DEMO_DATA;
  const STORE_KEY = "sourceflow-demo-v3";
  const statusValues = ["待开始", "进行中", "待提交", "已提交", "需补充", "已完成"];
  const copy = {
    zh: {
      demo:"演示版 · 数据均为虚构", chinaPortal:"中国采购执行端", localSaved:"本机自动保存已开启", currentProject:"当前项目", share:"分享", demoData:"演示数据",
      hqTitle:"韩国总部分析·任务确认", hqDesc:"商品原始分析仅由总部查看，中国分公司只接收已确认的执行条件。", hqOnly:"总部专用", wechatShare:"微信分享", shareHint:"复制演示地址后发送到微信群。", demoAddress:"演示地址", copyLink:"复制链接", shareCaution:"公开演示页，请勿录入真实供应商或个人信息。",
      nav:["任务中心","产品要求","供应商调查","样品与质检","提交与反馈"],
      missionCenter:"任务中心", missionDesc:"按完成标准执行韩国总部已确认的采购任务。", totalProgress:"整体完成率", dueMissions:"本周到期", evidenceCount:"待提交证据", hqFeedback:"总部反馈", priorityTasks:"当前任务", executionGuide:"交付原则", guideText:"每项任务必须同时提交结构化数据和原始证据。只有文字说明不视为完成。",
      requirements:"产品要求", reqDesc:"以下条件已由韩国总部确认。执行中不得自行变更。", fixedSpecs:"固定规格", targetTerms:"采购调查范围", targetCost:"目标出厂价", moqRange:"MOQ调查范围", sampleQty:"样品数量", deadline:"完成日期", rejection:"禁止条件 / 不合格标准", requiredEvidence:"必须提交的证据",
      supplierResearch:"供应商调查", supplierDesc:"优先确认制造工厂，并使用统一字段完成横向比较。", addSupplier:"添加供应商", supplier:"供应商", factory:"工厂", unit:"含包装单价", moq:"MOQ", lead:"交期", cert:"资料", note:"备注", yes:"是", no:"否", saveTable:"保存比较表", supplierHint:"演示数据可直接修改，系统会保存在当前浏览器。",
      sampleQuality:"样品与质检", qualityDesc:"登记样品信息，并逐项完成验收检查。", sampleInfo:"样品登记", tracking:"快递单号", sampleStatus:"样品状态", notOrdered:"未下单", ordered:"已下单", shipped:"运输中", received:"已收货", qualityChecklist:"质量检查表", files:"证据文件", upload:"选择演示文件", uploadHint:"演示版只记录文件名，不会上传文件内容。",
      submitFeedback:"提交与反馈", submitDesc:"提交阶段性结果，查看总部补充要求并完成再提交。", feedbackTitle:"韩国总部补充要求", feedbackBody:"请补充直接制造工厂证明，并用统一角度重新拍摄包装尺寸照片。", cnComment:"中国分公司执行说明", commentPlaceholder:"填写调查结论、问题和需要总部确认的事项…", submit:"提交阶段结果", resubmit:"重新提交", submitted:"已提交", activity:"项目动态", reset:"重置演示数据", resetConfirm:"确定要清除所有演示修改吗？", copied:"链接已复制", saved:"已保存", fileAdded:"已记录演示文件", resultSubmitted:"结果已提交给韩国总部", resetDone:"演示数据已恢复",
      hqFlow:["地址已录入","GPT分析完成","条件已确认","任务已下发"], hqSources:"三个商品的总部处理状态", analysisScore:"分析完整度", missionIssued:"已向中国分公司下发任务", protectedInfo:"原始地址、市场判断和总部决策依据不会显示在中国执行端。"
    },
    ko: {
      demo:"데모 버전 · 모든 데이터는 가상입니다", chinaPortal:"중국 소싱 실행 포털", localSaved:"브라우저 임시 저장 사용 중", currentProject:"현재 프로젝트", share:"공유", demoData:"가상 데이터",
      hqTitle:"한국 본사 분석·미션 확정", hqDesc:"상품 원본 분석은 본사에서만 확인하며 중국지사에는 확정된 실행 조건만 전달됩니다.", hqOnly:"본사 전용", wechatShare:"위챗 공유", shareHint:"데모 주소를 복사해 위챗으로 전달하세요.", demoAddress:"데모 주소", copyLink:"링크 복사", shareCaution:"공개 데모이므로 실제 공급사·개인정보를 입력하지 마세요.",
      nav:["미션 센터","제품 요구사항","공급사 조사","샘플·품질검사","제출·피드백"],
      missionCenter:"미션 센터", missionDesc:"한국 본사가 확정한 소싱 미션을 완료 조건에 맞춰 수행합니다.", totalProgress:"전체 완료율", dueMissions:"이번 주 마감", evidenceCount:"제출할 증빙", hqFeedback:"본사 피드백", priorityTasks:"현재 미션", executionGuide:"완료 원칙", guideText:"모든 미션은 구조화된 데이터와 원본 증빙을 함께 제출해야 완료됩니다.",
      requirements:"제품 요구사항", reqDesc:"다음 조건은 한국 본사 확정값이며 중국지사가 임의 변경할 수 없습니다.", fixedSpecs:"확정 규격", targetTerms:"소싱 조사 범위", targetCost:"목표 출고단가", moqRange:"MOQ 조사 범위", sampleQty:"샘플 수량", deadline:"완료일", rejection:"금지 조건·불합격 기준", requiredEvidence:"필수 제출 증빙",
      supplierResearch:"공급사 조사", supplierDesc:"제조공장 여부를 우선 확인하고 같은 필드로 비교합니다.", addSupplier:"공급사 추가", supplier:"공급사", factory:"공장", unit:"포장포함 단가", moq:"MOQ", lead:"납기", cert:"자료", note:"비고", yes:"예", no:"아니오", saveTable:"비교표 저장", supplierHint:"가상 데이터를 직접 수정할 수 있으며 현재 브라우저에 저장됩니다.",
      sampleQuality:"샘플·품질검사", qualityDesc:"샘플 정보를 등록하고 검사항목을 하나씩 완료합니다.", sampleInfo:"샘플 등록", tracking:"운송장 번호", sampleStatus:"샘플 상태", notOrdered:"미발주", ordered:"발주 완료", shipped:"운송 중", received:"수령 완료", qualityChecklist:"품질검사표", files:"증빙 파일", upload:"가상 파일 선택", uploadHint:"데모에서는 파일명만 기록하고 실제 내용은 업로드하지 않습니다.",
      submitFeedback:"제출·피드백", submitDesc:"단계별 결과를 제출하고 본사 보완요청을 확인한 뒤 재제출합니다.", feedbackTitle:"한국 본사 보완 요청", feedbackBody:"직접 제조공장 증빙을 보완하고 동일한 각도에서 포장 규격 사진을 다시 촬영하세요.", cnComment:"중국지사 실행 의견", commentPlaceholder:"조사 결론, 문제점, 본사 확인 필요사항을 입력하세요…", submit:"단계 결과 제출", resubmit:"다시 제출", submitted:"제출 완료", activity:"프로젝트 활동", reset:"데모 초기화", resetConfirm:"모든 데모 변경값을 초기화할까요?", copied:"링크를 복사했습니다", saved:"저장했습니다", fileAdded:"가상 파일명을 기록했습니다", resultSubmitted:"한국 본사에 결과를 제출했습니다", resetDone:"데모 데이터를 초기화했습니다",
      hqFlow:["주소 입력 완료","GPT 분석 완료","조건 확정","미션 전달"], hqSources:"3개 상품의 본사 처리 상태", analysisScore:"분석 완성도", missionIssued:"중국지사 미션 전달 완료", protectedInfo:"원본 주소, 시장 판단, 본사 의사결정 근거는 중국 실행 화면에 표시되지 않습니다."
    }
  };

  copy.zh.openImage = "查看大图";
  copy.ko.openImage = "크게 보기";

  const missionTemplates = [
    ["筛选5家候选制造工厂","제조공장 후보 5곳 선별","营业执照、工厂地址、现场照片","사업자등록·공장주소·현장사진","高"],
    ["确认制造工厂身份","제조공장 여부 확인","生产线和设备视频","생산라인·설비 영상","高"],
    ["完成标准报价表","표준 견적표 작성","盖章报价单或平台原始报价","직인 견적서 또는 플랫폼 원본 견적","高"],
    ["调查MOQ、交期和付款条件","MOQ·납기·결제조건 조사","统一比较表","통합 비교표","中"],
    ["申请并登记样品","샘플 신청·등록","付款记录和快递单号","결제기록·운송장","高"],
    ["按清单完成质量检查","체크리스트 품질검사","检测照片和视频","검사 사진·영상","高"],
    ["上传工厂和产品原始资料","공장·제품 원본자료 업로드","照片≥10张、视频≥2个","사진 10장·영상 2개 이상","中"],
    ["计算包装尺寸、重量和CBM","포장 규격·중량·CBM 계산","装箱数据和测量照片","포장데이터·측정사진","中"],
    ["确认认证和测试资料","인증·시험자료 확인","证书原件和有效期","인증서 원본·유효기간","中"],
    ["提交推荐工厂与理由","추천 공장·근거 제출","推荐1家、备选1家及风险说明","추천 1곳·차선 1곳·위험 설명","高"]
  ];

  function freshState(){
    const projects={};
    DATA.projects.forEach((p,pi)=>{
      projects[p.id]={
        missions:missionTemplates.map((m,i)=>({status:i<pi?"已完成":i===pi?"进行中":"待开始"})),
        suppliers:p.suppliers.map(s=>({...s})), quality:{}, tracking:"", sampleStatus:"未下单", files:[], comment:"", submitted:false,
        activity:[{time:"07-19 09:30",zh:"韩国总部已下发任务包",ko:"한국 본사가 미션 패키지를 전달했습니다."}]
      };
    });
    return {projectId:"P-001",view:0,lang:"zh",projects};
  }
  function loadState(){try{return {...freshState(),...JSON.parse(localStorage.getItem(STORE_KEY)||"null")};}catch(_){return freshState();}}
  let state=loadState();
  const $=s=>document.querySelector(s);
  const t=k=>copy[state.lang][k];
  const project=()=>DATA.projects.find(p=>p.id===state.projectId);
  const ps=()=>state.projects[state.projectId];
  function save(){localStorage.setItem(STORE_KEY,JSON.stringify(state));}
  function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(window._toast);window._toast=setTimeout(()=>el.classList.remove("show"),2400);}
  function esc(v){return String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
  function statusLabel(v){if(state.lang==="zh")return v;return ({"待开始":"대기","进行中":"진행 중","待提交":"제출 대기","已提交":"제출 완료","需补充":"보완 필요","已完成":"완료"})[v];}
  function statusClass(v){return ({"进行中":"running","待提交":"waiting","已提交":"submitted","需补充":"supplement","已完成":"done"})[v]||"";}
  function renderChrome(){
    document.documentElement.lang=state.lang==="zh"?"zh-CN":"ko";
    document.querySelectorAll("[data-i18n]").forEach(el=>{const v=t(el.dataset.i18n);if(v)el.textContent=v;});
    $("#langBtn").textContent=state.lang==="zh"?"한국어":"中文";
    $("#projectSelect").innerHTML=DATA.projects.map(p=>`<option value="${p.id}">${p.id} · ${p.name[state.lang]}</option>`).join("");
    $("#projectSelect").value=state.projectId;
    $("#sideNav").innerHTML=t("nav").map((name,i)=>`<button class="nav-btn ${state.view===i?"active":""}" data-view="${i}"><span class="nav-icon">${["✓","▤","⌂","◇","↥"][i]}</span><span>${name}</span>${i===0?`<span class="nav-count">${ps().missions.filter(m=>m.status!=="已完成").length}</span>`:""}</button>`).join("");
    $("#projectCode").textContent=`${project().id} · CHINA MISSION`;
    $("#projectName").textContent=project().name[state.lang];
    $("#projectPurpose").textContent=project().purpose[state.lang];
    $("#projectImage").src=project().image;
    $("#projectImage").alt=project().name[state.lang];
    $("#imageNote").textContent=project().imageNote[state.lang];
    $("#deadlineChip").textContent=`${t("deadline")} ${project().deadline}`;
    $("#shareUrl").value=DATA.shareUrl;
  }
  function progress(){const done=ps().missions.filter(m=>m.status==="已完成").length;return Math.round(done/ps().missions.length*100);}
  function statusOptions(selected){return statusValues.map(v=>`<option value="${v}" ${v===selected?"selected":""}>${statusLabel(v)}</option>`).join("");}
  function renderMissionCenter(){
    const p=project(),s=ps(),pc=progress();
    return `<div class="grid stats"><article class="card stat"><label>${t("totalProgress")}</label><strong>${pc}%</strong><div class="progress"><span style="width:${pc}%"></span></div></article><article class="card stat"><label>${t("dueMissions")}</label><strong>${s.missions.filter(m=>m.status!=="已完成").length}</strong><small>${p.deadline}</small></article><article class="card stat"><label>${t("evidenceCount")}</label><strong>${p.evidence[state.lang].length}</strong><small>${s.files.length} ${state.lang==="zh"?"个已登记":"개 등록"}</small></article><article class="card stat"><label>${t("hqFeedback")}</label><strong>1</strong><small>${state.lang==="zh"?"需要补充":"보완 필요"}</small></article></div>
    <div class="grid two-col"><article class="card"><div class="card-head"><div><h2>${t("priorityTasks")}</h2><p>${t("missionDesc")}</p></div><span class="badge running">${p.owner}</span></div><div class="mission-list">${missionTemplates.map((m,i)=>{const st=s.missions[i].status;return `<div class="mission"><span class="mission-check">${st==="已完成"?"✓":i+1}</span><div><h3>${m[state.lang==="zh"?0:1]}</h3><p>${state.lang==="zh"?"完成证据：":"완료 증빙: "}${m[state.lang==="zh"?2:3]}</p><div class="mission-meta"><span class="badge ${m[4]==="高"?"high":"medium"}">${state.lang==="zh"?m[4]:m[4]==="高"?"높음":"보통"}</span><span class="badge ${statusClass(st)}">${statusLabel(st)}</span></div></div><select data-mission="${i}" aria-label="Mission status">${statusOptions(st)}</select></div>`}).join("")}</div></article>
    <aside class="grid"><article class="card"><div class="card-head"><h2>${t("executionGuide")}</h2></div><p style="color:var(--muted);line-height:1.7">${t("guideText")}</p><ul class="evidence-list">${p.evidence[state.lang].map(x=>`<li>□ ${x}</li>`).join("")}</ul></article><article class="card"><div class="feedback"><b>${t("feedbackTitle")}</b><p>${t("feedbackBody")}</p></div></article></aside></div>`;
  }
  function renderRequirements(){const p=project();return `<div class="grid two-col"><article class="card"><div class="card-head"><div><h2>${t("fixedSpecs")}</h2><p>${t("reqDesc")}</p></div><span class="secure-chip">HQ LOCKED</span></div><div class="requirements">${p.specs.map(r=>`<div class="req"><label>${r[state.lang==="zh"?0:2]}</label><b>${r[state.lang==="zh"?1:3]}</b></div>`).join("")}</div></article><aside class="grid"><article class="card"><div class="card-head"><h2>${t("targetTerms")}</h2></div><div class="requirements"><div class="req"><label>${t("targetCost")}</label><b>${p.targetCost}</b></div><div class="req"><label>${t("moqRange")}</label><b>${p.moq}</b></div><div class="req"><label>${t("sampleQty")}</label><b>${p.sampleQty}</b></div><div class="req"><label>${t("deadline")}</label><b>${p.deadline}</b></div></div></article><article class="card"><div class="card-head"><h2>${t("rejection")}</h2></div><ul class="warning-list">${p.forbidden[state.lang].map(x=>`<li>${x}</li>`).join("")}</ul></article><article class="card"><div class="card-head"><h2>${t("requiredEvidence")}</h2></div><ul class="evidence-list">${p.evidence[state.lang].map(x=>`<li>□ ${x}</li>`).join("")}</ul></article></aside></div>`;}
  function supplierRow(s,i){return `<tr><td><input class="supplier-name" data-supplier="${i}" data-field="name" value="${esc(s.name)}"></td><td><select data-supplier="${i}" data-field="factory"><option value="是" ${s.factory==="是"?"selected":""}>${t("yes")}</option><option value="否" ${s.factory==="否"?"selected":""}>${t("no")}</option></select></td>${["unit","moq","lead","cert","note"].map(f=>`<td><input data-supplier="${i}" data-field="${f}" value="${esc(s[f])}"></td>`).join("")}</tr>`;}
  function renderSuppliers(){return `<article class="card"><div class="card-head"><div><h2>${t("supplierResearch")}</h2><p>${t("supplierDesc")}</p></div><button class="btn soft" id="addSupplier">+ ${t("addSupplier")}</button></div><div class="table-wrap"><table class="table"><thead><tr>${["supplier","factory","unit","moq","lead","cert","note"].map(k=>`<th>${t(k)}</th>`).join("")}</tr></thead><tbody>${ps().suppliers.map(supplierRow).join("")}</tbody></table></div><p style="color:var(--muted);font-size:11px">${t("supplierHint")}</p><button class="btn primary" id="saveSuppliers">${t("saveTable")}</button></article>`;}
  function renderQuality(){const p=project(),s=ps();return `<div class="grid two-col"><div class="grid"><article class="card"><div class="card-head"><h2>${t("sampleInfo")}</h2><span class="badge running">${p.sampleQty}</span></div><div class="field-row"><label class="field"><span>${t("tracking")}</span><input id="trackingInput" value="${esc(s.tracking)}" placeholder="SF123456789CN"></label><label class="field"><span>${t("sampleStatus")}</span><select id="sampleStatus"><option value="未下单">${t("notOrdered")}</option><option value="已下单">${t("ordered")}</option><option value="运输中">${t("shipped")}</option><option value="已收货">${t("received")}</option></select></label></div></article><article class="card"><div class="card-head"><h2>${t("qualityChecklist")}</h2><span>${Object.values(s.quality).filter(Boolean).length}/${p.quality.length}</span></div><div class="check-grid">${p.quality.map((q,i)=>`<label class="check-item"><input type="checkbox" data-quality="${i}" ${s.quality[i]?"checked":""}><span>${state.lang==="zh"?q:({"尺寸与重量":"규격·중량","外观与缝制":"외관·봉제","异味检查":"냄새 검사","24小时回弹":"24시간 복원","压缩包装":"압축 포장","洗后变形":"세탁 후 변형","尺寸与垂直度":"규격·수직도","编织张力":"직조 장력","合页开合":"경첩 개폐","表面毛刺":"표면 마감","站立稳定":"자립 안정성","包装跌落":"포장 낙하","滚筒尺寸":"롤 규격","单卷撕数":"롤당 매수","斜线易撕":"사선 절취","织物粘毛":"섬유 점착","残胶检查":"잔사 검사","手柄耐久":"핸들 내구"})[q]}</span></label>`).join("")}</div></article></div><aside class="card"><div class="card-head"><h2>${t("files")}</h2><span class="badge">${s.files.length}</span></div><div class="upload-zone"><b>${t("upload")}</b><p>${t("uploadHint")}</p><input id="fileInput" type="file" multiple></div><div class="file-list">${s.files.map(f=>`<span class="file-pill">${esc(f)}</span>`).join("")}</div></aside></div>`;}
  function renderSubmit(){const s=ps();return `<div class="grid two-col"><div class="grid"><article class="card"><div class="card-head"><h2>${t("feedbackTitle")}</h2><span class="badge supplement">${state.lang==="zh"?"需补充":"보완 필요"}</span></div><div class="feedback"><b>HQ · 2026-07-19</b><p>${t("feedbackBody")}</p></div><label class="field"><span>${t("cnComment")}</span><textarea id="commentInput" placeholder="${t("commentPlaceholder")}">${esc(s.comment)}</textarea></label><button class="btn primary block" id="submitResult">${s.submitted?t("resubmit"):t("submit")}</button></article><button class="btn danger" id="resetDemo">${t("reset")}</button></div><aside class="card"><div class="card-head"><h2>${t("activity")}</h2><span class="badge ${s.submitted?"submitted":"waiting"}">${s.submitted?t("submitted"):statusLabel("进行中")}</span></div><div class="activity">${s.activity.map(a=>`<div class="activity-row"><time>${a.time}</time><span>${a[state.lang]}</span></div>`).join("")}</div></aside></div>`;}
  function renderView(){const root=$("#viewRoot");root.innerHTML=[renderMissionCenter,renderRequirements,renderSuppliers,renderQuality,renderSubmit][state.view]();bindView();}
  function bindView(){
    document.querySelectorAll("[data-mission]").forEach(el=>el.addEventListener("change",e=>{ps().missions[+e.target.dataset.mission].status=e.target.value;save();renderAll();}));
    document.querySelectorAll("[data-supplier]").forEach(el=>el.addEventListener("change",e=>{ps().suppliers[+e.target.dataset.supplier][e.target.dataset.field]=e.target.value;save();}));
    $("#addSupplier")?.addEventListener("click",()=>{ps().suppliers.push({name:state.lang==="zh"?"新供应商":"새 공급사",factory:"是",unit:"",moq:"",lead:"",cert:"",note:""});save();renderView();});
    $("#saveSuppliers")?.addEventListener("click",()=>toast(t("saved")));
    if($("#sampleStatus")){ $("#sampleStatus").value=ps().sampleStatus; $("#sampleStatus").addEventListener("change",e=>{ps().sampleStatus=e.target.value;save();}); }
    $("#trackingInput")?.addEventListener("input",e=>{ps().tracking=e.target.value;save();});
    document.querySelectorAll("[data-quality]").forEach(el=>el.addEventListener("change",e=>{ps().quality[e.target.dataset.quality]=e.target.checked;save();renderView();}));
    $("#fileInput")?.addEventListener("change",e=>{ps().files.push(...[...e.target.files].map(f=>f.name));save();toast(t("fileAdded"));renderView();});
    $("#commentInput")?.addEventListener("input",e=>{ps().comment=e.target.value;save();});
    $("#submitResult")?.addEventListener("click",()=>{ps().submitted=true;ps().activity.unshift({time:new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}),zh:"中国分公司已提交阶段结果",ko:"중국지사가 단계 결과를 제출했습니다."});save();toast(t("resultSubmitted"));renderView();});
    $("#resetDemo")?.addEventListener("click",()=>{if(confirm(t("resetConfirm"))){const keep={lang:state.lang,projectId:state.projectId,view:state.view};state={...freshState(),...keep};save();renderAll();toast(t("resetDone"));}});
  }
  function renderHq(){const p=project();$("#hqRoot").innerHTML=`<div class="hq-flow">${t("hqFlow").map((x,i)=>`<div class="hq-step"><span>0${i+1}</span><b>${x}</b></div>`).join("")}</div><div class="grid two-col"><article class="card"><div class="card-head"><h2>${t("hqSources")}</h2><span class="secure-chip">HQ ONLY</span></div>${DATA.projects.map(x=>`<div class="source-card"><div class="source-icon">${x.icon}</div><div><h3>${x.id} · ${x.name[state.lang]}</h3><p>${x.hq.summary[state.lang]}</p><div class="locked">🔒 ${t("protectedInfo")}</div></div><span class="badge done">${x.hq.stage[state.lang]}</span></div>`).join("")}</article><aside class="grid"><article class="card stat"><label>${t("analysisScore")}</label><strong>${p.hq.score}%</strong><div class="progress"><span style="width:${p.hq.score}%"></span></div></article><article class="card"><h2>${t("missionIssued")}</h2><p style="color:var(--muted);line-height:1.7">${p.purpose[state.lang]}</p><button class="btn soft block" id="goChina">${state.lang==="zh"?"查看中国执行端":"중국 실행화면 보기"}</button></article></aside></div>`;$("#goChina").addEventListener("click",()=>setRole("cn"));}
  function renderAll(){renderChrome();renderView();renderHq();}
  function setRole(role){const cn=role==="cn";$("#cnApp").hidden=!cn;$("#krApp").hidden=cn;$("#roleCn").classList.toggle("active",cn);$("#roleKr").classList.toggle("active",!cn);}
  $("#sideNav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(!b)return;state.view=+b.dataset.view;save();setRole("cn");renderAll();});
  $("#projectSelect").addEventListener("change",e=>{state.projectId=e.target.value;save();renderAll();});
  $("#langBtn").addEventListener("click",()=>{state.lang=state.lang==="zh"?"ko":"zh";save();renderAll();});
  $("#roleCn").addEventListener("click",()=>setRole("cn"));$("#roleKr").addEventListener("click",()=>setRole("kr"));
  $("#shareBtn").addEventListener("click",()=>$("#shareDialog").showModal());$("#closeDialog").addEventListener("click",()=>$("#shareDialog").close());
  $("#projectImageBtn").addEventListener("click",()=>{const p=project();$("#imageDialogTitle").textContent=`${p.id} · ${p.name[state.lang]}`;$("#imageDialogNote").textContent=p.imageNote[state.lang];$("#imageDialogImg").src=p.image;$("#imageDialogImg").alt=p.name[state.lang];$("#imageDialog").showModal();});
  $("#closeImageDialog").addEventListener("click",()=>$("#imageDialog").close());
  $("#copyBtn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(DATA.shareUrl);}catch(_){$("#shareUrl").select();document.execCommand("copy");}toast(t("copied"));});
  renderAll();
})();
