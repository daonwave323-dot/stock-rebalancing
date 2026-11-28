#!/usr/bin/env python3
"""반도체 폭락 자료(data/crashes_sox.json)를 ^SOX 일봉에서 다시 만든다 — 화면의 8사례·현재·2단계 브레이크·백테스트.

  python3 tools/make_crashes_sox.py            # 야후에서 받아 data/crashes_sox.json 새로 씀

· 자료출처: 야후 파이낸스 ^SOX(1995~) · SOXL(2010~) · ^VIX(2008~) 일봉. 키가 필요 없다.
· 점수는 원본 앱(Singularity.kt) 식 그대로 — 낙폭 .30 · 주간 RSI .20 · VIX/50일 .15 · 200일선 .15 · 일간 RSI .10 · 공포 .10.
· 표에 적히는 값은 모두 이 스크립트가 일봉에서 계산한 값이다(지어낸 값 없음).
· 8사례 = SOX가 고점 대비 35% 이상 빠진 구간(보고서 2쪽 표와 같은 사건). 현재(2026)는 마지막 고점 이후 구간.
· 백테스트 = SOXL 90점 첫 돌파(80 미만 → 90 이상) 대비 2단계 필터 A(SOX −35% 이상 하락)·B(+6개월) 비교.
"""
import bisect
import datetime
import json
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'data', 'crashes_sox.json')
CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
UA = {'User-Agent': 'Mozilla/5.0'}


def fetch(sym, p1, p2):
    url = CHART + urllib.parse.quote(sym) + '?period1=%d&period2=%d&interval=1d' % (p1, p2)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
        return json.loads(r.read().decode())


def series(sym, y0, y1):
    """일봉 종가 — 야후는 한 번에 긴 구간을 주지 않아 4년씩 끊어 받는다."""
    out = {}
    y = y0
    while y <= y1:
        p1 = int(datetime.datetime(y, 1, 1, tzinfo=datetime.timezone.utc).timestamp())
        p2 = int(datetime.datetime(min(y + 4, y1 + 1), 1, 1, tzinfo=datetime.timezone.utc).timestamp())
        d = fetch(sym, p1, p2)['chart']['result'][0]
        ts = d.get('timestamp') or []
        q = d['indicators']['quote'][0]
        for i, t in enumerate(ts):
            c = q['close'][i]
            if c is None:
                continue
            out[datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%d')] = c
        y += 4
    return dict(sorted(out.items()))



NOWY = datetime.datetime.now(datetime.timezone.utc).year
sox = series('^SOX', 1995, NOWY)
soxl = series('SOXL', 2010, NOWY)
vix = series('^VIX', 2008, NOWY)
sd=sorted(sox); sc=[sox[x] for x in sd]
vd=sorted(vix); vc=[vix[x] for x in vd]
idx={d:i for i,d in enumerate(sd)}

# ---------------------------------------------------------------- 점수(원본 앱 식)
W = {'dd': .30, 'wrsi': .20, 'vixr': .15, 'gap': .15, 'drsi': .10, 'vixp': .10}


def _clamp(x):
    return max(0.0, min(100.0, x))


def _conv(key, v):
    if key == 'dd': x = v / 20.0 * 100          # 반도체(SOXL)는 20
    elif key == 'wrsi': x = (70 - v) / 40 * 100
    elif key == 'vixr': x = (v - 1) / 0.4 * 100
    elif key == 'gap': x = -v / 30 * 100
    elif key == 'drsi': x = (50 - v) / 20 * 100
    else: x = v
    return _clamp(x)


def _rsi(cl, n=14):
    if len(cl) < n + 1:
        return None
    g = l = 0.0
    for i in range(1, n + 1):
        ch = cl[i] - cl[i - 1]
        if ch > 0: g += ch
        else: l -= ch
    ag, al = g / n, l / n
    for i in range(n + 1, len(cl)):
        ch = cl[i] - cl[i - 1]
        ag = (ag * (n - 1) + max(ch, 0)) / n
        al = (al * (n - 1) + max(-ch, 0)) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def build(prices, vixd, start=None):
    """날마다 여섯 지표 → 0~100 점수. live_update.py·gauge.js 와 같은 식."""
    dates = sorted(prices)
    closes = [prices[d] for d in dates]
    vd = sorted(vixd)
    vc = [vixd[d] for d in vd]
    weeks = {}
    for d, c in zip(dates, closes):
        y, m, dd = [int(x) for x in d.split('-')]
        iso = datetime.date(y, m, dd).isocalendar()
        weeks[(iso[0], iso[1])] = c
    wk = sorted(weeks)
    widx = {k: i for i, k in enumerate(wk)}
    out = []
    for i, d in enumerate(dates):
        if start and d < start:
            continue
        c = closes[i]
        lo = max(0, i - 1259)
        peak = max(closes[lo:i + 1])
        ma = sum(closes[max(0, i - 199):i + 1]) / len(closes[max(0, i - 199):i + 1])
        y, m, dd = [int(x) for x in d.split('-')]
        iso = datetime.date(y, m, dd).isocalendar()
        wcl = [weeks[wk[j]] for j in range(widx[(iso[0], iso[1])] + 1)]
        wcl[-1] = c
        j = bisect.bisect_right(vd, d) - 1
        if j < 0:
            continue
        v = vc[j]
        v50 = sum(vc[max(0, j - 49):j + 1]) / len(vc[max(0, j - 49):j + 1])
        win = vc[max(0, j - 251):j + 1]
        vals = {'dd': abs((c / peak - 1) * 100), 'wrsi': _rsi(wcl), 'vixr': v / v50,
                'gap': (c / ma - 1) * 100, 'drsi': _rsi(closes[:i + 1]),
                'vixp': sum(1 for x in win if x <= v) / len(win) * 100}
        ws = sum(W[k] for k in W if vals[k] is not None)
        s = sum(_conv(k, vals[k]) * W[k] for k in W if vals[k] is not None)
        out.append({'d': d, 'c': c, 'score': round(s / ws, 1) if ws else None, 'v': vals})
    return out


def wilder(cl,n=14):
    if len(cl)<n+1: return None
    g=l=0.0
    for i in range(1,n+1):
        ch=cl[i]-cl[i-1]
        if ch>0: g+=ch
        else: l-=ch
    ag=g/n; al=l/n
    for i in range(n+1,len(cl)):
        ch=cl[i]-cl[i-1]; ag=(ag*(n-1)+max(ch,0))/n; al=(al*(n-1)+max(-ch,0))/n
    if al==0: return 100.0
    return 100-100/(1+ag/al)

def metrics(i):
    """i번째 SOX 날의 지표 — 낙폭(i 이전 5년 최고 대비), 200일선 이격, 일간 RSI, VIX."""
    lo=max(0,i-1259); pk=max(sc[lo:i+1]); pki=lo+sc[lo:i+1].index(pk)
    ma=sum(sc[max(0,i-199):i+1])/len(sc[max(0,i-199):i+1])
    j=bisect.bisect_right(vd,sd[i])-1
    return {'dd':(sc[i]/pk-1)*100,'peakI':pki,'peakClose':pk,'gap':(sc[i]/ma-1)*100 if ma else None,
            'rsi':wilder(sc[:i+1]),'vix':vc[j] if j>=0 else None}

CYC=[('1995-09-11','1996-07-24'),('1997-08-20','1998-10-08'),('2000-03-10','2002-10-09'),
     ('2004-01-12','2004-09-08'),('2007-07-17','2008-11-20'),('2020-02-19','2020-03-18'),
     ('2021-12-27','2022-10-14'),('2024-07-10','2025-04-08')]
META=[
 ('sox-1996','1996 D램 불황','1996','#E2503F','업황 사이클','D램 불황 · 업황만 꺾임','공급 과잉이 만든 첫 사이클 바닥. 지수는 1년 안에 2.5배 가까이 올랐다.'),
 ('sox-1998','1998 아시아 외환위기','1998','#FF8A3D','업황 사이클','외환위기 · 업황 동반','1996년과 같은 바닥을 다시 한 번 확인한 자리. 회복도 빨랐다.'),
 ('sox-2000','2000 닷컴 버블 붕괴','2000','#A78BFA','경제 위기','버블 붕괴 + 업황 붕괴','공급 과잉과 자금 조달 경색이 겹쳤다. 전고점 회복에 17년이 걸렸다.'),
 ('sox-2004','2004 사이클 조정','2004','#4C8DFF','업황 사이클','재고 조정','가격 상승이 먼저 멈추고 주가가 뒤따라 빠진 사이클 조정.'),
 ('sox-2008','2008 글로벌 금융위기','2008','#22D3A5','경제 위기','신용경색','세계 경기 침체가 업황과 무관하게 지수를 끌어내렸다.'),
 ('sox-2020','2020 코로나19 팬데믹','2020','#F5D547','업황 사이클','팬데믹 급락','8건 중 가장 짧은 하락. 1개월 만에 바닥을 찍고 반등했다.'),
 ('sox-2022','2022 인플레·금리 인상','2022','#E879B9','업황 사이클','금리가 바닥을 정함','점수는 일찍 90을 찍었지만 금리가 꺾일 때까지 주가는 더 내렸다.'),
 ('sox-2025','2025 AI·관세 조정','2025','#54B6F0','업황 사이클','관세 충격','관세 발표로 급락, 5개월 만에 반등. 바닥 후 1년에 약 2.5배.'),
]

def series_slice(a,b,base_i,base_close,trough_i=None,trough_close=None):
    out=[]
    for i in range(a,b+1):
        out.append([i-base_i, (sc[i]/base_close-1)*100])
    return out

SC=build(soxl,vix,start='2010-03-11')
SCD={x['d']:x['score'] for x in SC}
def score_at(d):
    ks=[k for k in SCD if k<=d]
    return SCD[ks[-1]] if ks else None

cases=[]
for (pk,tr),(cid,name,short,color,typ,tag,note) in zip(CYC,META):
    pi=idx[pk]; ti=idx[tr]
    peak, trough=sc[pi], sc[ti]
    rec=None
    for j in range(ti,len(sc)):
        if sc[j]>=peak: rec=sd[j]; break
    worst=1e9; wd=None
    for j in range(pi+1,ti+1):
        ch=(sc[j]/sc[j-1]-1)*100
        if ch<worst: worst=ch; wd=sd[j]
    pre=[ [i-pi, (sc[i]/peak-1)*100] for i in range(max(0,pi-252),pi) ]
    end=min(len(sc)-1, ti+126)
    path=[ [i-pi,(sc[i]/peak-1)*100] for i in range(pi,end+1) ]
    t0=max(0,ti-252); t1=min(len(sc)-1,ti+252)
    troughPath=[ [i-ti,(sc[i]/trough-1)*100] for i in range(t0,t1+1) ]
    mp=metrics(pi); mt=metrics(ti)
    cases.append({
      'id':cid,'name':name,'short':short,'color':color,'tag':tag,'type':typ,'index':'SOX','note':note,
      'peak':pk,'peak_close':round(peak,2),'trough':tr,'trough_close':round(trough,2),
      'dd':round((trough/peak-1)*100,2),'days_to_trough':ti-pi,
      'days_to_recovery':(idx[rec]-ti) if rec else None,'recovery':rec,
      'worst':('%+.2f%% (%s)'%(worst,wd)) if wd else None,
      'peak_rsi':round(mp['rsi'],1) if mp['rsi'] is not None else None,
      'peak_gap':round(mp['gap'],1) if mp['gap'] is not None else None,
      'peak_vix':round(mp['vix'],2) if mp['vix'] else None,
      'trough_rsi':round(mt['rsi'],1) if mt['rsi'] is not None else None,
      'trough_vix':round(mt['vix'],2) if mt['vix'] else None,
      'prePath':[[x,round(y,2)] for x,y in pre],
      'path':[[x,round(y,2)] for x,y in path],
      'troughPath':[[x,round(y,2)] for x,y in troughPath],
      'preFrom':sd[max(0,pi-252)],'troughFrom':sd[t0],'troughTo':sd[t1],
      'markX':ti-pi,'markY':round((trough/peak-1)*100,2),
    })
    # SOXL 점수(2010-03 이후만) — 그 사례의 고점·저점 점수와 90점 첫 돌파
    ps=score_at(pk); ts_=score_at(tr)
    f90=None
    for i in range(pi,min(len(sc),ti+252)):
        v=score_at(sd[i])
        if v is not None and v>=90: f90=(sd[i],i-pi,v); break
    cases[-1]['peak_score']=ps; cases[-1]['trough_score']=ts_
    cases[-1]['first90']=('%s · 고점 +%d거래일 · %.1f점'%(f90[0],f90[1],f90[2])) if f90 else None
    cases[-1]['seen']=[
      '고점 %s · RSI %s, 200일선 이격 %s%%, VIX %s'%(pk, cases[-1]['peak_rsi'], cases[-1]['peak_gap'], cases[-1]['peak_vix']),
      '고점 대비 −35%%를 넘은 날부터 이 구간으로 셉니다 — 저점까지 %d거래일(%.1f개월)'%(ti-pi,(ti-pi)/21.0),
    ]
    cases[-1]['unseen']=[
      'SOXL 90점 첫 돌파: %s'%(cases[-1]['first90'] or '이 구간에 90점 돌파 없음(2010년 이전)'),
      '저점 뒤 전고점 회복: %s'%(('%s · 저점 +%d거래일'%(rec, idx[rec]-ti)) if rec else '자료 끝까지 미회복'),
      '이 구간의 유형 — %s. 점수만으로는 유형을 가릴 수 없습니다.'%typ,
    ]
    cases[-1]['recovery']=rec

# 현재(2026)
now=len(sc)-1
pi=idx['2026-06-22']; peak=sc[pi]
ti=min(range(pi,now+1), key=lambda i: sc[i])
cur=sc[now]
months=(now-pi)/21.0
NOW={
 'as_of':sd[now],'index':'SOX','peak':'2026-06-22','peak_close':round(peak,2),
 'trough':sd[ti],'trough_close':round(sc[ti],2),
 'dd':round((sc[ti]/peak-1)*100,2),'days_to_trough':ti-pi,'months_since_peak':round(months,1),
 'close':round(cur,2),'dd_now':round((cur/peak-1)*100,2),
 'days_since_trough':now-ti,'above_trough':round((cur/sc[ti]-1)*100,2),
}

# 2단계 브레이크
def brake(state):
    dd=state['dd_now']; mo=state['months_since_peak']
    band = -53 <= dd <= -35
    dur_ok = mo>=6
    return {'band':band,'dur_ok':dur_ok,'pass':band and dur_ok,'dd':dd,'months':mo}

# 백테스트
s=build(soxl,vix,start='2011-03-09')
dd_=[x['d'] for x in s]; cc=[x['c'] for x in s]; ss=[x['score'] for x in s]
eps=[];armed=True
for i,v in enumerate(ss):
    if v is None: continue
    if v<80: armed=True
    if armed and v>=90: eps.append(i); armed=False
def fwd(i,n): return (cc[i+n]/cc[i]-1)*100 if i+n<len(cc) else None
def stt(idxs,n):
    r=[fwd(i,n) for i in idxs]; done=[x for x in r if x is not None]
    return {'n':len(idxs),'done':len(done),
            'mean':round(sum(done)/len(done),2) if done else None,
            'win':round(100*sum(1 for x in done if x>0)/len(done),1) if done else None}
def soxat(d):
    i=bisect.bisect_right(sd,d)-1
    m=metrics(i); m['months']=(i-m['peakI'])/21.0; return m
A=[i for i in eps if soxat(dd_[i])['dd']<=-35]
B=[i for i in eps if soxat(dd_[i])['dd']<=-35 and soxat(dd_[i])['months']>=6]
base_r=[(cc[i+21]/cc[i]-1)*100 for i in range(len(cc)-21)]
BT={
 'from':dd_[0],'to':dd_[-1],'rows':len(cc),
 'rule':'점수가 80 미만으로 내려간 뒤 다시 90을 넘은 첫날. +21거래일 = 그 종가에서 21거래일 뒤 종가.',
 'all_days':{'n':len(base_r),'mean':round(sum(base_r)/len(base_r),2),'win':round(100*sum(1 for x in base_r if x>0)/len(base_r),1)},
 'plain':{'213':stt(eps,21),'63':stt(eps,63)},
 'filterA':{'213':stt(A,21),'63':stt(A,63),'dates':[dd_[i] for i in A]},
 'filterB':{'213':stt(B,21),'63':stt(B,63),'dates':[dd_[i] for i in B]},
 'filterAdetail':[{'date':dd_[i],'score':ss[i],'sox_dd':round(soxat(dd_[i])['dd'],1),'sox_months':round(soxat(dd_[i])['months'],1),
                   'f21':None if fwd(i,21) is None else round(fwd(i,21),2),'f63':None if fwd(i,63) is None else round(fwd(i,63),2)} for i in A],
}

# 현재와 닮은 날 — SOX 지표(낙폭·200일선·RSI·VIX) 거리
curm=metrics(now)
_j=bisect.bisect_right(vd,sd[now])-1
_v50=sum(vc[max(0,_j-49):_j+1])/len(vc[max(0,_j-49):_j+1])
_vwin=vc[max(0,_j-251):_j+1]
curm['vix_ratio']=round(vc[_j]/_v50,2); curm['vix_pct']=round(100*sum(1 for x in _vwin if x<=vc[_j])/len(_vwin),1)
for c in cases:
    pi=idx[c['peak']]; ti=idx[c['trough']]
    best=None
    for i in range(pi, min(len(sc),ti+126)):
        m=metrics(i)
        parts=[abs(m['dd']-curm['dd'])]
        if m['gap'] is not None: parts.append(abs(m['gap']-curm['gap']))
        if m['rsi'] is not None: parts.append(abs(m['rsi']-curm['rsi']))
        if m['vix'] is not None and curm['vix'] is not None: parts.append(abs(m['vix']-curm['vix']))
        dist=sum(parts)/len(parts)/10
        if best is None or dist<best[0]: best=(dist,i,m,len(parts))
    if not best: continue
    dist,i,m,nm=best
    def f(n): return round((sc[i+n]/sc[i]-1)*100,2) if i+n<len(sc) else None
    c['now_match']={'date':sd[i],'day':i-pi,'dd':round(m['dd'],2),'gap':round(m['gap'],2),'rsi':round(m['rsi'],1),
                    'vix':(round(m['vix'],2) if m['vix'] is not None else None),'metricsUsed':nm,'distance':round(dist,2),'fwdIndex':'SOX',
                    'fwd30':f(30),'fwd90':f(90),'fwd180':f(180)}
    off=now-pi
    c['sameDay']=round((sc[min(pi+off,len(sc)-1)]/c['peak_close']-1)*100,2) if pi+off<len(sc) else None

# 현재(SOX) — 겹쳐 보기 선·상세 차트용 경로(사례와 같은 규격)
newpi=idx['2026-06-22']; pk0=sc[newpi]
ti0=min(range(newpi,now+1), key=lambda i: sc[i])   # 지금 구간의 저점(마지막 사례 ti 를 쓰면 안 된다)
prePath=[[i-newpi, round((sc[i]/pk0-1)*100,2)] for i in range(max(0,newpi-252),newpi)]
path=[[i-newpi, round((sc[i]/pk0-1)*100,2)] for i in range(newpi, now+1)]
tc=sc[ti0]
troughPath=[[i-ti0, round((sc[i]/tc-1)*100,2)] for i in range(max(0,ti0-252), min(len(sc),ti0+252)+0)]
troughPath=[p for p in troughPath if ti0+p[0]<=now]
NOW['from']=sd[max(0,newpi-252)]; NOW['to']=sd[now]; NOW['peakI']=newpi; NOW['troughI']=ti0; NOW['lastI']=now
NOW['daysToRecovery']=None; NOW['backPct']=round((cur-tc)/(pk0-tc)*100,1)
NOW['ov']={'dd':round((cur/pk0-1)*100,2),'src':'close','label':'확정 종가 · %s'%sd[now],
  'peak':prePath+path,'trough':troughPath,'offset':now-newpi,'confOffset':now-newpi,
  'troughOffset':now-ti0,'troughConf':now-ti0,'firstDate':sd[newpi],'lastDate':sd[now],
  'lastConfirmed':sd[now],'liveDate':None,'n':now-newpi+1,'troughDate':sd[ti0]}
NOW['chart']={'id':'now','name':'현재','short':'현재','color':'var(--blue)','tag':'2026 진행 중','type':'진행 중',
  'index':'SOX','peak':'2026-06-22','peak_close':round(pk0,2),'trough':sd[ti0],'trough_close':round(tc,2),
  'dd':round((tc/pk0-1)*100,2),'days_to_trough':ti0-newpi,'days_to_recovery':None,
  'prePath':prePath,'path':path,'troughPath':troughPath,'markX':ti0-newpi,'markY':round((tc/pk0-1)*100,2),
  'preFrom':sd[max(0,newpi-252)],'troughFrom':sd[max(0,ti0-252)],'troughTo':sd[now]}

out={
 'as_of':sd[now],'index':'SOX','index_name':'필라델피아 반도체 지수','source':'야후 파이낸스 ^SOX 일봉(1995-01-03~%s)'%sd[now],
 'note':'1994년 이후 SOX가 고점 대비 35% 이상 빠진 구간 8개와 지금(2026) 진행 중인 구간. 모든 수치는 ^SOX 일봉에서 직접 계산했다.',
 'now':NOW,'brake':brake(NOW),'cur_metrics':{k:(round(v,2) if isinstance(v,float) else v) for k,v in curm.items() if k in ('dd','gap','rsi','vix','vix_ratio','vix_pct')},
 'backtest':BT,'cases':cases
}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('cases', len(cases), '→', OUT)
print('now',NOW)
print('brake',brake(NOW))
print('BT plain',BT['plain']); print('A',BT['filterA']['213'],'B',BT['filterB']['213']); print('baseline',BT['all_days'])
