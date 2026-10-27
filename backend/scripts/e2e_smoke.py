import httpx, sys
B="http://127.0.0.1:8000"; F="http://127.0.0.1:5173"
ok=[]; bad=[]
def chk(name, cond, extra=""):
    (ok if cond else bad).append(name)
    print(("PASS " if cond else "FAIL ")+name+((" | "+str(extra)) if extra and not cond else ""))

base={"hotel":{"lng":121.4737,"lat":31.2304,"name":"人民广场"},"destinations":[
 {"id":"d1","name":"外滩","lng":121.4921,"lat":31.2335,"selected":True,"stayMin":60},
 {"id":"d2","name":"豫园·城隍庙","lng":121.4925,"lat":31.2259,"selected":True,"stayMin":75}],
 "days":1,"mode":"transit","weights":{"time":0.6,"convenience":0.5,"cost":0.4,"walking":0.5},
 "options":{"dayStartTime":"09:00","dayEndTime":"18:00","lunchBreakMin":60}}

with httpx.Client(timeout=90, trust_env=False) as c:
    r=c.get(B+"/api/health"); chk("health", r.status_code==200 and r.json()["status"]=="ok")
    r=c.get(B+"/api/poi/presets"); chk("poi presets", r.status_code==200 and len(r.json())>200)
    r=c.get(B+"/api/poi/search", params={"q":"咖啡"}); chk("poi search", r.status_code==200)
    r=c.post(B+"/api/plan", json=base); chk("plan", r.status_code==200 and len(r.json()["days"][0]["stops"])==2)
    r=c.post(B+"/api/plan", json={**base,"mode":"taxi"}); chk("plan taxi", r.status_code==200)
    r=c.post(B+"/api/plan", json={**base,"legModes":{"d2":"taxi","__return__":"walk"}})
    modes=[s["transportFromPrev"]["mode"] for s in r.json()["days"][0]["stops"]]
    chk("plan legModes", r.status_code==200 and "taxi" in modes, modes)
    r=c.post(B+"/api/plan", json={**base,"limits":{"budgetCap":20}})
    chk("plan limits 字段", r.status_code==200 and (r.json()["solver"].get("limits") is not None))

    cases=[("少走路，6 点前回酒店","act"),("推荐几家四星酒店","answer"),("明天会下雨吗","answer"),("改地铁","act")]
    for text, kind in cases:
        r=c.post(B+"/api/ai/turn", json={**base,"text":text,"cityPois":[],"cityName":"上海","history":[]})
        j=r.json() if r.status_code==200 else {}
        chk(f"turn {text[:6]}", r.status_code==200 and j.get("kind")==kind and "source" in j, j)
        chk(f"turn {text[:6]} 无误报酒店", not (kind=="act" and "没有酒店的星级" in j.get("reply","")))

    r=c.post(B+"/api/ai/turn", json={**base,"text":"改地铁","cityPois":[],"cityName":"上海","history":[]},
             headers={"x-llm-key":"sk-bogus"})
    chk("turn 假Key 兜底", r.status_code==200 and r.json().get("source")=="rules")

    turn=c.post(B+"/api/ai/turn", json={**base,"text":"预算20，改成打车","cityPois":[],"cityName":"上海","history":[]}).json()
    r=c.post(B+"/api/ai/apply", json={**base,"ops":turn["ops"]})
    j=r.json() if r.status_code==200 else {}
    chk("apply 约束降档", r.status_code==200 and "地铁" in j.get("caption",""), j.get("caption"))

    r=c.post(B+"/api/share", json={"trip_data":{**base,"version":1}}); code=r.json().get("code","")
    chk("share 生成", r.status_code==200 and len(code)==6)
    chk("share 取回", c.get(B+f"/api/share/{code}").status_code==200)
    chk("share 404", c.get(B+"/api/share/ZZZZZZ").status_code==404)
    chk("ai parse", c.post(B+"/api/ai/parse", json={"text":"想去外滩和豫园"}).status_code==200)
    chk("ai explain", c.post(B+"/api/ai/explain", json={"plan":c.post(B+"/api/plan", json=base).json()}).status_code==200)

    # 前端路由（Vite 返回 HTML）
    for path in ["/", "/plan", "/me", f"/s/{code}", "/trip/x"]:
        r=c.get(F+path)
        chk(f"页面 {path}", r.status_code==200 and "<div id=\"root\"" in r.text, r.status_code)

print(f"\n合计 {len(ok)} 通过 / {len(bad)} 失败" + (f" -> {bad}" if bad else ""))
sys.exit(0 if not bad else 1)
