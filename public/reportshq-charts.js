var ve=globalThis.HTMLElement||class{},Ln=(t)=>String(t??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"),fn=(t,n)=>{let i=n.trim().split("."),e=t;for(let r of i)e=e?.[r];return typeof e==="function"?e.call(t):e},Wn=(t,n,i)=>{if(t===null)return n==="boolean"?!1:i;if(n==="boolean")return t!=="false"&&t!=="0";if(n==="number")return Number(t);if(n==="object"||n==="array")try{return JSON.parse(t)}catch{return i}return t},Se=(t,n)=>{if(t==null||t===!1)return null;if(n==="boolean")return"";if(n==="object"||n==="array")return JSON.stringify(t);return String(t)},Ce=(t,n)=>{if(t==null||n!=="object"&&n!=="array")return t;if(typeof structuredClone==="function")return structuredClone(t);return JSON.parse(JSON.stringify(t))},cn=(t)=>Ce(t.default??{string:"",number:0,boolean:!1,object:{},array:[]}[t.type],t.type);class A extends ve{static definition={};static get observedAttributes(){return this.definition.observedAttributes||[]}constructor(){super();this._values=Object.create(null),this._reflecting=!1,this._connected=!1,this._hasConnected=!1,this._initializing=!1,this._updatePending=!1,this._listeners=new Map;let t=this.constructor.definition;for(let[n,i]of Object.entries(t.properties||{}))this._values[n]=cn(i);if(t.shadowMode&&this.attachShadow&&!this.shadowRoot)this._closedRoot=this.attachShadow({mode:t.shadowMode})}get updateComplete(){return this._updateComplete||Promise.resolve()}get renderRoot(){return this._closedRoot||this.shadowRoot||this}connectedCallback(){if(this._connected)return;this._connected=!0,this._initializing=!0;let t=this.constructor.definition;for(let[r,a]of Object.entries(t.properties||{})){let s=a.attribute===!1?null:a.attribute||r.replace(/[A-Z]/g,(o)=>"-"+o.toLowerCase());if(s&&this.hasAttribute?.(s))this._values[r]=Wn(this.getAttribute(s),a.type,cn(a))}for(let r of Object.keys(t.properties||{}))this._upgradeProperty(r);this._initializing=!1;let i=[...this.renderRoot.childNodes||[]].some((r)=>r.nodeType!==3||r.textContent.trim()),e=!this._hasConnected;if(!(e&&t.progressive&&i))this._render();else this._upgradeDeclarativeEvents();if(this._bindEvents(),e)this._hasConnected=!0,this.setAttribute?.("hydrated",""),this.dispatchEvent?.(new CustomEvent("stx:hydrated",{bubbles:!0,composed:!0}))}disconnectedCallback(){this._connected=!1;for(let[t,n]of this._listeners)this.renderRoot.removeEventListener(t,n);this._listeners.clear()}attributeChangedCallback(t,n,i){if(n===i||this._reflecting)return;let e=this.constructor.definition,r=e.attributeToProperty?.[t];if(!r)return;let a=e.properties[r],s=Wn(i,a.type,cn(a));if(!Object.is(this._values[r],s))this._values[r]=s,this.requestUpdate()}_props(){return this._values}requestUpdate(){if(!this._connected||this._initializing||this._updatePending)return this.updateComplete;return this._updatePending=!0,this._updateComplete=new Promise((t)=>{queueMicrotask(()=>{if(this._updatePending=!1,this._connected)this._render();t()})}),this._updateComplete}emit(t,n,i={}){return this.dispatchEvent(new CustomEvent(t,{detail:n,bubbles:!0,composed:!0,...i}))}_upgradeProperty(t){if(!Object.prototype.hasOwnProperty.call(this,t))return;let n=this[t];delete this[t],this[t]=n}_upgradeDeclarativeEvents(){for(let t of this.renderRoot.querySelectorAll?.("*")||[]){let n=t.getAttributeNames?.()||[...t.attributes||[]].filter(Boolean).map((i)=>i.name);for(let i of n){if(!i?.startsWith("@"))continue;let[e,...r]=i.slice(1).split(".");if(t.setAttribute("data-stx-on-"+e,t.getAttribute(i)),r.length)t.setAttribute("data-stx-mod-"+e,r.join(" "));t.removeAttribute(i)}}}_bindEvents(){for(let t of this.constructor.definition.eventTypes||[]){if(this._listeners.has(t))continue;let n=(i)=>{let e="[data-stx-on-"+t+"]",r=i.target?.closest?.(e);if(!r||!this.renderRoot.contains(r))return;let a=(r.getAttribute("data-stx-mod-"+t)||"").split(" ");if(a.includes("prevent"))i.preventDefault();if(a.includes("stop"))i.stopPropagation();let s=r.getAttribute("data-stx-on-"+t);if(typeof this[s]==="function")this[s](i)};this.renderRoot.addEventListener(t,n),this._listeners.set(t,n)}}_render(){let t=this.constructor.definition,n=this.renderRoot,i=n.activeElement||(n.contains?.(globalThis.document?.activeElement)?globalThis.document.activeElement:null),e=i&&(i.getAttribute?.("data-key")||i.id||i.getAttribute?.("name")),r=i&&"selectionStart"in i?[i.selectionStart,i.selectionEnd]:null,a=typeof this.render==="function"?this.render(Ee):t.template.replace(new RegExp("\\{!!\\s*([\\w$.]+)\\s*!!\\}","g"),(s,o)=>String(fn(this,o)??"")).replace(new RegExp("\\{\\{\\s*([\\w$.]+)\\s*\\}\\}","g"),(s,o)=>Ln(fn(this,o)));if(t.shadowMode&&t.styles)a="<style>"+t.styles+"</style>"+a;if(n.innerHTML=a,this._applyBindings(),this._bindEvents(),e){let s=globalThis.CSS?.escape?globalThis.CSS.escape(e):e.replace(/["\\]/g,"$&"),o=n.querySelector('[data-key="'+s+'"],#'+s+',[name="'+s+'"]');if(o?.focus?.(),r&&o?.setSelectionRange)o.setSelectionRange(r[0],r[1])}this.dispatchEvent?.(new CustomEvent("stx:updated",{bubbles:!1}))}_applyBindings(){for(let t of this.constructor.definition.bindings||[]){let n=this.renderRoot.querySelector("[data-stx-bind-"+t.id+"]");if(!n)continue;let i=fn(this,t.expression);if(t.name==="class")n.className=i||"";else if(t.name==="style"&&typeof i==="object")Object.assign(n.style,i);else if(typeof i==="boolean"){if(n.toggleAttribute(t.name,i),t.name in n)n[t.name]=i}else if(i==null||i===!1)n.removeAttribute(t.name);else n.setAttribute(t.name,String(i))}}}var Ee={escape:Ln,raw:(t)=>String(t??""),values:(t)=>t==null?[]:t[Symbol.iterator]?t:Object.values(t),entries:(t)=>t==null?[]:Array.isArray(t)?t.entries():Object.entries(t)};function F(t,n){let i=n.properties||{},e={},r=[];for(let[s,o]of Object.entries(i)){let l=o.attribute===!1?null:o.attribute||s.replace(/[A-Z]/g,(h)=>"-"+h.toLowerCase());if(l)e[l]=s,r.push(l);Object.defineProperty(t.prototype,s,{configurable:!0,enumerable:!0,get(){return this._values[s]},set(h){let g=this._values[s];if(Object.is(g,h))return;if(this._values[s]=h,o.reflect&&l&&!this._reflecting){let f=Se(h,o.type);if(this._reflecting=!0,f===null)this.removeAttribute(l);else this.setAttribute(l,f);this._reflecting=!1}this.requestUpdate(),this.dispatchEvent?.(new CustomEvent(s+"-changed",{detail:{value:h,oldValue:g},bubbles:!0,composed:!0}))}})}t.definition={...n,attributeToProperty:e,observedAttributes:r};let a=globalThis.customElements||globalThis.window?.customElements;if(a&&!a.get(n.tag))a.define(n.tag,t);return t}function De(t){return Math.abs(t=Math.round(t))>=1000000000000000000000?t.toLocaleString("en").replace(/,/g,""):t.toString(10)}function Ot(t,n){if(!isFinite(t)||t===0)return null;let i=n?t.toExponential(n-1):t.toExponential(),e=i.indexOf("e"),r=i.slice(0,e);return[r.length>1?r[0]+r.slice(2):r,+i.slice(e+1)]}function Ae(t){let n=Ot(Math.abs(t));return n?n[1]:NaN}function Ue(t,n){return function(i,e){let r=i.length,a=[],s=0,o=t[0],l=0;while(r>0&&o>0){if(l+o+1>e)o=Math.max(1,e-l);if(a.push(i.substring(r-=o,r+o)),(l+=o+1)>e)break;o=t[s=(s+1)%t.length]}return a.reverse().join(n)}}function Oe(t){return function(n){return n.replace(/[0-9]/g,function(i){return t[+i]})}}var Fe=/^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;class gn{fill;align;sign;symbol;zero;width;comma;precision;trim;type;constructor(t){this.fill=t.fill===void 0?" ":`${t.fill}`,this.align=t.align===void 0?">":`${t.align}`,this.sign=t.sign===void 0?"-":`${t.sign}`,this.symbol=t.symbol===void 0?"":`${t.symbol}`,this.zero=!!t.zero,this.width=t.width===void 0?void 0:+t.width,this.comma=!!t.comma,this.precision=t.precision===void 0?void 0:+t.precision,this.trim=!!t.trim,this.type=t.type===void 0?"":`${t.type}`}toString(){return this.fill+this.align+this.sign+this.symbol+(this.zero?"0":"")+(this.width===void 0?"":Math.max(1,this.width|0))+(this.comma?",":"")+(this.precision===void 0?"":`.${Math.max(0,this.precision|0)}`)+(this.trim?"~":"")+this.type}}function ii(t){let n=Fe.exec(t);if(!n)throw Error(`invalid format: ${t}`);return new gn({fill:n[1],align:n[2],sign:n[3],symbol:n[4],zero:n[5],width:n[6],comma:n[7],precision:n[8]&&n[8].slice(1),trim:n[9],type:n[10]})}ii.prototype=gn.prototype;var Pe=ii,Vn=Pe;function je(t){let n=-1,i=0;t:for(let e=t.length,r=1;r<e;++r)switch(t[r]){case".":n=i=r;break;case"0":if(n===0)n=r;i=r;break;default:if(!+t[r])break t;if(n>0)n=0;break}return n>0?t.slice(0,n)+t.slice(i+1):t}var kt;function Ye(t,n){let i=Ot(t,n);if(!i)return kt=void 0,t.toPrecision(n);let e=i[0],r=i[1];kt=Math.max(-8,Math.min(8,Math.floor(r/3)))*3;let a=r-kt+1,s=e.length;return a===s?e:a>s?`${e}${Array(a-s+1).join("0")}`:a>0?`${e.slice(0,a)}.${e.slice(a)}`:`0.${Array(1-a).join("0")}${Ot(t,Math.max(0,n+a-1))[0]}`}function Bn(t,n){let i=Ot(t,n);if(!i)return`${t}`;let e=i[0],r=i[1];return r<0?`0.${Array(-r).join("0")}${e}`:e.length>r+1?`${e.slice(0,r+1)}.${e.slice(r+1)}`:`${e}${Array(r-e.length+2).join("0")}`}var He={"%":(t,n)=>(t*100).toFixed(n),b:(t)=>Math.round(t).toString(2),c:(t)=>`${t}`,d:De,e:(t,n)=>t.toExponential(n),f:(t,n)=>t.toFixed(n),g:(t,n)=>t.toPrecision(n),o:(t)=>Math.round(t).toString(8),p:(t,n)=>Bn(t*100,n),r:Bn,s:Ye,X:(t)=>Math.round(t).toString(16).toUpperCase(),x:(t)=>Math.round(t).toString(16)},Kn=He;function Qn(t){return t}var ti=Array.prototype.map,ni=["y","z","a","f","p","n","µ","m","","k","M","G","T","P","E","Z","Y"];function Re(t){let n=t.grouping===void 0||t.thousands===void 0?Qn:Ue(ti.call(t.grouping,Number),`${t.thousands}`),i=t.currency===void 0?"":t.currency[0]+"",e=t.currency===void 0?"":t.currency[1]+"",r=t.decimal===void 0?".":`${t.decimal}`,a=t.numerals===void 0?Qn:Oe(ti.call(t.numerals,String)),s=t.percent===void 0?"%":`${t.percent}`,o=t.minus===void 0?"−":`${t.minus}`,l=t.nan===void 0?"NaN":`${t.nan}`;function h(f,y){let c=Vn(f),_=c.fill,p=c.align,m=c.sign,u=c.symbol,d=c.zero,T=c.width,S=c.comma,D=c.precision,z=c.trim,$=c.type;if($==="n")S=!0,$="g";else if(!Kn[$]){if(D===void 0)D=12;z=!0,$="g"}if(d||_==="0"&&p==="=")d=!0,_="0",p="=";let V=(y&&y.prefix!==void 0?y.prefix:"")+(u==="$"?i:u==="#"&&/[boxX]/.test($)?`0${$.toLowerCase()}`:""),bt=(u==="$"?e:/[%p]/.test($)?s:"")+(y&&y.suffix!==void 0?y.suffix:""),et=Kn[$],Nt=/[defgprs%]/.test($);D=D===void 0?6:/[gprs]/.test($)?Math.max(1,Math.min(21,D)):Math.max(0,Math.min(20,D));function rt(M){let Y=V,v=bt,I,st,X;if($==="c")v=et(M)+v,M="";else{M=+M;let H=M<0||1/M<0;if(M=isNaN(M)?l:et(Math.abs(M),D),z)M=je(M);if(H&&+M===0&&m!=="+")H=!1;if(Y=(H?m==="("?m:o:m==="-"||m==="("?"":m)+Y,v=($==="s"&&!isNaN(M)&&kt!==void 0?ni[8+kt/3]:"")+v+(H&&m==="("?")":""),Nt){I=-1,st=M.length;while(++I<st)if(X=M.charCodeAt(I),48>X||X>57){v=(X===46?r+M.slice(I+1):M.slice(I))+v,M=M.slice(0,I);break}}}if(S&&!d)M=n(M,1/0);let at=Y.length+M.length+v.length,E=at<(T??0)?Array((T??0)-at+1).join(_):"";if(S&&d)M=n(E+M,E.length?(T??0)-v.length:1/0),E="";switch(p){case"<":M=Y+M+v+E;break;case"=":M=Y+E+M+v;break;case"^":{let H=E.length>>1;M=E.slice(0,H)+Y+M+v+E.slice(H);break}default:M=E+Y+M+v;break}return a(M)}return rt.toString=function(){return`${c}`},rt}function g(f,y){let c=Vn(f);c.type="f";let _=Math.max(-8,Math.min(8,Math.floor(Ae(y)/3)))*3,p=Math.pow(10,-_),m=h(`${c}`,{suffix:ni[8+_/3]});return function(u){return m(p*u)}}return{format:h,formatPrefix:g}}var Ut,ht,Ie;ze({thousands:",",grouping:[3],currency:["$",""]});function ze(t){return Ut=Re(t),ht=Ut.format,Ie=Ut.formatPrefix,Ut}function Yt(t,n){return t==null||n==null?NaN:t<n?-1:t>n?1:t>=n?0:NaN}function qe(t,n){return t==null||n==null?NaN:n<t?-1:n>t?1:n>=t?0:NaN}function vn(t){let n,i,e;if(t.length!==2)n=Yt,i=(o,l)=>Yt(t(o),l),e=(o,l)=>t(o)-l;else n=t===Yt||t===qe?t:Ze,i=t,e=t;function r(o,l,h=0,g=o.length){if(h<g){if(n(l,l)!==0)return g;do{let f=h+g>>>1;if(i(o[f],l)<0)h=f+1;else g=f}while(h<g)}return h}function a(o,l,h=0,g=o.length){if(h<g){if(n(l,l)!==0)return g;do{let f=h+g>>>1;if(i(o[f],l)<=0)h=f+1;else g=f}while(h<g)}return h}function s(o,l,h=0,g=o.length){let f=r(o,l,h,g-1);return f>h&&e(o[f-1],l)>-e(o[f],l)?f-1:f}return{left:r,center:s,right:a}}function Ze(){return 0}function Je(t){return t===null?NaN:+t}var ki=vn(Yt),Xe=ki.right,Da=ki.left,Aa=vn(Je).center,Ge=Xe;var We=Math.sqrt(50),Le=Math.sqrt(10),Ve=Math.sqrt(2);function Ht(t,n,i){let e=(n-t)/Math.max(0,i),r=Math.floor(Math.log10(e)),a=e/Math.pow(10,r),s=a>=We?10:a>=Le?5:a>=Ve?2:1,o,l,h;if(r<0){if(h=Math.pow(10,-r)/s,o=Math.round(t*h),l=Math.round(n*h),o/h<t)++o;if(l/h>n)--l;h=-h}else{if(h=Math.pow(10,r)*s,o=Math.round(t/h),l=Math.round(n/h),o*h<t)++o;if(l*h>n)--l}if(l<o&&0.5<=i&&i<2)return Ht(t,n,i*2);return[o,l,h]}function Be(t,n,i){if(n=+n,t=+t,i=+i,!(i>0))return[];if(t===n)return[t];let e=n<t,[r,a,s]=e?Ht(n,t,i):Ht(t,n,i);if(!(a>=r))return[];let o=a-r+1,l=Array(o);if(e)if(s<0)for(let h=0;h<o;++h)l[h]=(a-h)/-s;else for(let h=0;h<o;++h)l[h]=(a-h)*s;else if(s<0)for(let h=0;h<o;++h)l[h]=(r+h)/-s;else for(let h=0;h<o;++h)l[h]=(r+h)*s;return l}function mn(t,n,i){return n=+n,t=+t,i=+i,Ht(t,n,i)[2]}function Tn(t,n,i){n=+n,t=+t,i=+i;let e=n<t,r=e?mn(n,t,i):mn(t,n,i);return(e?-1:1)*(r<0?1/-r:r)}function Ke(t,n){switch(arguments.length){case 0:break;case 1:this.range(t);break;default:this.range(n).domain(t);break}return this}var Ua=Symbol("implicit");var Qe=/^#([0-9a-f]{3,8})$/,tr=new RegExp("^rgb\\(\\s*([+-]?\\d+)\\s*,\\s*([+-]?\\d+)\\s*,\\s*([+-]?\\d+)\\s*\\)$"),nr=new RegExp("^rgb\\(\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*\\)$"),ir=new RegExp("^rgba\\(\\s*([+-]?\\d+)\\s*,\\s*([+-]?\\d+)\\s*,\\s*([+-]?\\d+)\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*\\)$"),er=new RegExp("^rgba\\(\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*\\)$"),rr=new RegExp("^hsl\\(\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*\\)$"),sr=new RegExp("^hsla\\(\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*,\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*\\)$"),ei={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074};function Rt(t){return isNaN(t)?1:Math.max(0,Math.min(1,t))}function ut(t){return Math.max(0,Math.min(255,Math.round(t)||0))}function lt(t){return t=ut(t),(t<16?"0":"")+t.toString(16)}function ri(t){return t=(t||0)%360,t<0?t+360:t}function Ft(t){return Math.max(0,Math.min(1,t||0))}function _n(t,n,i){return(t<60?n+(i-n)*t/60:t<180?i:t<240?n+(i-n)*(240-t)/60:n)*255}class Q{opacity;copy(t){return Object.assign(Object.create(Object.getPrototypeOf(this)),this,t)}displayable(){return this.rgb().displayable()}formatHex(){return this.rgb().formatHex()}formatHex8(){return this.rgb().formatHex8()}formatHsl(){return or(this).formatHsl()}formatRgb(){return this.rgb().formatRgb()}toString(){return this.rgb().formatRgb()}rgb(){return this.rgb()}hex(){return this.formatHex()}}Q.prototype.hex=Q.prototype.formatHex;class R extends Q{r;g;b;constructor(t,n,i,e){super();this.r=+t,this.g=+n,this.b=+i,this.opacity=+e}brighter(t){return t=t==null?1.4285714285714286:Math.pow(1.4285714285714286,t),new R(this.r*t,this.g*t,this.b*t,this.opacity)}darker(t){return t=t==null?0.7:Math.pow(0.7,t),new R(this.r*t,this.g*t,this.b*t,this.opacity)}rgb(){return this}clamp(){return new R(ut(this.r),ut(this.g),ut(this.b),Rt(this.opacity))}displayable(){return-0.5<=this.r&&this.r<255.5&&(-0.5<=this.g&&this.g<255.5)&&(-0.5<=this.b&&this.b<255.5)&&(0<=this.opacity&&this.opacity<=1)}formatHex(){return`#${lt(this.r)}${lt(this.g)}${lt(this.b)}`}hex(){return this.formatHex()}formatHex8(){return`#${lt(this.r)}${lt(this.g)}${lt(this.b)}${lt((isNaN(this.opacity)?1:this.opacity)*255)}`}formatRgb(){let t=Rt(this.opacity);return`${t===1?"rgb(":"rgba("}${ut(this.r)}, ${ut(this.g)}, ${ut(this.b)}${t===1?")":`, ${t})`}`}toString(){return this.formatRgb()}}R.prototype.hex=R.prototype.formatHex;class W extends Q{h;s;l;constructor(t,n,i,e){super();this.h=+t,this.s=+n,this.l=+i,this.opacity=+e}brighter(t){return t=t==null?1.4285714285714286:Math.pow(1.4285714285714286,t),new W(this.h,this.s,this.l*t,this.opacity)}darker(t){return t=t==null?0.7:Math.pow(0.7,t),new W(this.h,this.s,this.l*t,this.opacity)}rgb(){let t=this.h%360+(this.h<0?360:0),n=isNaN(t)||isNaN(this.s)?0:this.s,i=this.l,e=i+(i<0.5?i:1-i)*n,r=2*i-e;return new R(_n(t>=240?t-240:t+120,r,e),_n(t,r,e),_n(t<120?t+240:t-120,r,e),this.opacity)}clamp(){return new W(ri(this.h),Ft(this.s),Ft(this.l),Rt(this.opacity))}displayable(){return(0<=this.s&&this.s<=1||isNaN(this.s))&&(0<=this.l&&this.l<=1)&&(0<=this.opacity&&this.opacity<=1)}formatHsl(){let t=Rt(this.opacity);return`${t===1?"hsl(":"hsla("}${ri(this.h)}, ${Ft(this.s)*100}%, ${Ft(this.l)*100}%${t===1?")":`, ${t})`}`}}function si(t){return new R(t>>16&255,t>>8&255,t&255,1)}function Pt(t,n,i,e){if(e<=0)t=n=i=NaN;return new R(t,n,i,e)}function ai(t,n,i,e){if(e<=0)t=n=i=NaN;else if(i<=0||i>=1)t=n=NaN;else if(n<=0)t=NaN;return new W(t,n,i,e)}function Sn(t){let n;if(t=`${t}`.trim().toLowerCase(),n=Qe.exec(t)){let i=n[1].length,e=parseInt(n[1],16);if(i===6)return si(e);if(i===3)return new R(e>>8&15|e>>4&240,e>>4&15|e&240,(e&15)<<4|e&15,1);if(i===8)return Pt(e>>24&255,e>>16&255,e>>8&255,(e&255)/255);if(i===4)return Pt(e>>12&15|e>>8&240,e>>8&15|e>>4&240,e>>4&15|e&240,((e&15)<<4|e&15)/255);return null}if(n=tr.exec(t))return new R(+n[1],+n[2],+n[3],1);if(n=nr.exec(t))return new R(+n[1]*255/100,+n[2]*255/100,+n[3]*255/100,1);if(n=ir.exec(t))return Pt(+n[1],+n[2],+n[3],+n[4]);if(n=er.exec(t))return Pt(+n[1]*255/100,+n[2]*255/100,+n[3]*255/100,+n[4]);if(n=rr.exec(t))return ai(+n[1],+n[2]/100,+n[3]/100,1);if(n=sr.exec(t))return ai(+n[1],+n[2]/100,+n[3]/100,+n[4]);if(Object.prototype.hasOwnProperty.call(ei,t))return si(ei[t]);if(t==="transparent")return new R(NaN,NaN,NaN,0);return null}function ar(t){if(!(t instanceof Q))t=Sn(t);if(!t)return new R(NaN,NaN,NaN,NaN);let n=t.rgb();return new R(n.r,n.g,n.b,n.opacity)}function bn(t,n,i,e){if(n===void 0&&i===void 0)return ar(t);return new R(t,n,i,e==null?1:e)}function or(t){if(t instanceof W)return new W(t.h,t.s,t.l,t.opacity);if(!(t instanceof Q))t=Sn(t);if(!t)return new W(NaN,NaN,NaN,NaN);if(t instanceof W)return t;let n=t.rgb(),i=n.r/255,e=n.g/255,r=n.b/255,a=Math.min(i,e,r),s=Math.max(i,e,r),o=NaN,l=s-a,h=(s+a)/2;if(l){if(i===s)o=(e-r)/l+(e<r?6:0);else if(e===s)o=(r-i)/l+2;else o=(i-e)/l+4;l/=h<0.5?s+a:2-s-a,o*=60}else l=h>0&&h<1?0:o;return new W(o,l,h,n.opacity)}function $i(t,n,i,e,r){let a=t*t,s=a*t;return((1-3*t+3*a-s)*n+(4-6*a+3*s)*i+(1+3*t+3*a-3*s)*e+s*r)/6}function hr(t){let n=t.length-1;return function(i){let e=i<=0?i=0:i>=1?(i=1,n-1):Math.floor(i*n),r=t[e],a=t[e+1],s=e>0?t[e-1]:2*r-a,o=e<n-1?t[e+2]:2*a-r;return $i((i-e/n)*n,s,r,a,o)}}function lr(t){let n=t.length;return function(i){let e=Math.floor(((i%=1)<0?++i:i)*n),r=t[(e+n-1)%n],a=t[e%n],s=t[(e+1)%n],o=t[(e+2)%n];return $i((i-e/n)*n,r,a,s,o)}}var ur=(t)=>()=>t,Cn=ur;function fr(t,n){return function(i){return t+i*n}}function cr(t,n,i){return t=Math.pow(t,i),n=Math.pow(n,i)-t,i=1/i,function(e){return Math.pow(t+e*n,i)}}function gr(t){return(t=+t)===1?vi:function(n,i){return i-n?cr(n,i,t):Cn(isNaN(n)?i:n)}}function vi(t,n){let i=n-t;return i?fr(t,i):Cn(isNaN(t)?n:t)}var oi=function t(n){let i=gr(n);function e(r,a){let s=bn(r),o=bn(a),l=i(s.r,o.r),h=i(s.g,o.g),g=i(s.b,o.b),f=vi(s.opacity,o.opacity);return function(y){return s.r=l(y),s.g=h(y),s.b=g(y),s.opacity=f(y),`${s}`}}return e.gamma=t,e}(1);function Si(t){return function(n){let i=n.length,e=Array(i),r=Array(i),a=Array(i),s,o;for(s=0;s<i;++s)o=bn(n[s]),e[s]=o.r||0,r[s]=o.g||0,a[s]=o.b||0;let l=t(e),h=t(r),g=t(a);return o.opacity=1,function(f){return o.r=l(f),o.g=h(f),o.b=g(f),`${o}`}}}var Oa=Si(hr),Fa=Si(lr);function _r(t,n){if(!n)n=[];let i=t?Math.min(n.length,t.length):0,e=ArrayBuffer.isView(n)?new n.constructor(n):Array.prototype.slice.call(n),r;return function(a){for(r=0;r<i;++r)e[r]=t[r]*(1-a)+n[r]*a;return e}}function yr(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function xr(t,n){let i=n?n.length:0,e=t?Math.min(i,t.length):0,r=Array(e),a=Array(i),s;for(s=0;s<e;++s)r[s]=En(t[s],n[s]);for(;s<i;++s)a[s]=n[s];return function(o){for(s=0;s<e;++s)a[s]=r[s](o);return a}}function dr(t,n){let i=new Date,e=+t,r=+n;return function(a){return i.setTime(e*(1-a)+r*a),i}}function It(t,n){let i=+t,e=+n;return function(r){return i*(1-r)+e*r}}function pr(t,n){let i={},e={},r;if(t===null||typeof t!=="object")t={};if(n===null||typeof n!=="object")n={};for(r in n)if(r in t)i[r]=En(t[r],n[r]);else e[r]=n[r];return function(a){for(r in i)e[r]=i[r](a);return e}}var Nn=/[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g,yn=new RegExp(Nn.source,"g");function Mr(t){return function(){return t}}function wr(t){return function(n){return`${t(n)}`}}function mr(t,n){let i=Nn.lastIndex=yn.lastIndex=0,e,r,a,s=-1,o=[],l=[],h=`${t}`,g=`${n}`;while((e=Nn.exec(h))&&(r=yn.exec(g))){if((a=r.index)>i)if(a=g.slice(i,a),o[s])o[s]+=a;else o[++s]=a;if(e===r)if(o[s])o[s]+=r[0];else o[++s]=r[0];else o[++s]=null,l.push({i:s,x:It(+e[0],+r[0])});i=yn.lastIndex}if(i<g.length)if(a=g.slice(i),o[s])o[s]+=a;else o[++s]=a;return o.length<2?l[0]?wr(l[0].x):Mr(g):(g=l.length,function(f){for(let y=0,c;y<g;++y)o[(c=l[y]).i]=c.x(f);return o.join("")})}function En(t,n){let i=typeof n,e;return n==null||i==="boolean"?Cn(n):(i==="number"?It:i==="string"?(e=Sn(n))?(n=e,oi):mr:n instanceof Q?oi:n instanceof Date?dr:yr(n)?_r:Array.isArray(n)?xr:typeof n.valueOf!=="function"&&typeof n.toString!=="function"||isNaN(n)?pr:It)(t,n)}function Tr(t,n){let i=+t,e=+n;return function(r){return Math.round(i*(1-r)+e*r)}}function br(t){return function(){return t}}function Nr(t){return+t}var hi=[0,1];function _t(t){return t}function kn(t,n){return(n-=t=+t)?function(i){return(i-t)/n}:br(isNaN(n)?NaN:0.5)}function kr(t,n){let i;if(t>n)i=t,t=n,n=i;return function(e){return Math.max(t,Math.min(n,e))}}function $r(t,n,i){let e=t[0],r=t[1],a=n[0],s=n[1],o,l;if(r<e)o=kn(r,e),l=i(s,a);else o=kn(e,r),l=i(a,s);return function(h){return l(o(h))}}function vr(t,n,i){let e=Math.min(t.length,n.length)-1,r=Array(e),a=Array(e),s=-1;if(t[e]<t[0])t=t.slice().reverse(),n=n.slice().reverse();while(++s<e)r[s]=kn(t[s],t[s+1]),a[s]=i(n[s],n[s+1]);return function(o){let l=Ge(t,o,1,e)-1;return a[l](r[l](o))}}function Sr(t,n){return n.domain(t.domain()).range(t.range()).interpolate(t.interpolate()).clamp(t.clamp()).unknown(t.unknown())}function Cr(){let t=hi,n=hi,i=En,e,r,a,s=_t,o,l,h;function g(){let y=Math.min(t.length,n.length);if(s!==_t)s=kr(t[0],t[y-1]);return o=y>2?vr:$r,l=h=null,f}function f(y){return y==null||isNaN(y=+y)?a:(l||(l=o(t.map(e),n,i)))(e(s(y)))}return f.invert=function(y){return s(r((h||(h=o(n,t.map(e),It)))(y)))},f.domain=function(y){return arguments.length?(t=Array.from(y,Nr),g()):t.slice()},f.range=function(y){return arguments.length?(n=Array.from(y),g()):n.slice()},f.rangeRound=function(y){return n=Array.from(y),i=Tr,g()},f.clamp=function(y){return arguments.length?(s=y?!0:_t,g()):s!==_t},f.interpolate=function(y){return arguments.length?(i=y,g()):i},f.unknown=function(y){return arguments.length?(a=y,f):a},function(y,c){return e=y,r=c,g()}}function Er(){return Cr()(_t,_t)}function Dr(t){return Math.abs(t=Math.round(t))>=1000000000000000000000?t.toLocaleString("en").replace(/,/g,""):t.toString(10)}function zt(t,n){if(!isFinite(t)||t===0)return null;let i=n?t.toExponential(n-1):t.toExponential(),e=i.indexOf("e"),r=i.slice(0,e);return[r.length>1?r[0]+r.slice(2):r,+i.slice(e+1)]}function yt(t){let n=zt(Math.abs(t));return n?n[1]:NaN}function Ar(t,n){return function(i,e){let r=i.length,a=[],s=0,o=t[0],l=0;while(r>0&&o>0){if(l+o+1>e)o=Math.max(1,e-l);if(a.push(i.substring(r-=o,r+o)),(l+=o+1)>e)break;o=t[s=(s+1)%t.length]}return a.reverse().join(n)}}function Ur(t){return function(n){return n.replace(/[0-9]/g,function(i){return t[+i]})}}var Or=/^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;class Dn{fill;align;sign;symbol;zero;width;comma;precision;trim;type;constructor(t){this.fill=t.fill===void 0?" ":`${t.fill}`,this.align=t.align===void 0?">":`${t.align}`,this.sign=t.sign===void 0?"-":`${t.sign}`,this.symbol=t.symbol===void 0?"":`${t.symbol}`,this.zero=!!t.zero,this.width=t.width===void 0?void 0:+t.width,this.comma=!!t.comma,this.precision=t.precision===void 0?void 0:+t.precision,this.trim=!!t.trim,this.type=t.type===void 0?"":`${t.type}`}toString(){return this.fill+this.align+this.sign+this.symbol+(this.zero?"0":"")+(this.width===void 0?"":Math.max(1,this.width|0))+(this.comma?",":"")+(this.precision===void 0?"":`.${Math.max(0,this.precision|0)}`)+(this.trim?"~":"")+this.type}}function Ci(t){let n=Or.exec(t);if(!n)throw Error(`invalid format: ${t}`);return new Dn({fill:n[1],align:n[2],sign:n[3],symbol:n[4],zero:n[5],width:n[6],comma:n[7],precision:n[8]&&n[8].slice(1),trim:n[9],type:n[10]})}Ci.prototype=Dn.prototype;var Fr=Ci,$n=Fr;function Pr(t){let n=-1,i=0;t:for(let e=t.length,r=1;r<e;++r)switch(t[r]){case".":n=i=r;break;case"0":if(n===0)n=r;i=r;break;default:if(!+t[r])break t;if(n>0)n=0;break}return n>0?t.slice(0,n)+t.slice(i+1):t}var Et;function jr(t,n){let i=zt(t,n);if(!i)return Et=void 0,t.toPrecision(n);let e=i[0],r=i[1];Et=Math.max(-8,Math.min(8,Math.floor(r/3)))*3;let a=r-Et+1,s=e.length;return a===s?e:a>s?`${e}${Array(a-s+1).join("0")}`:a>0?`${e.slice(0,a)}.${e.slice(a)}`:`0.${Array(1-a).join("0")}${zt(t,Math.max(0,n+a-1))[0]}`}function li(t,n){let i=zt(t,n);if(!i)return`${t}`;let e=i[0],r=i[1];return r<0?`0.${Array(-r).join("0")}${e}`:e.length>r+1?`${e.slice(0,r+1)}.${e.slice(r+1)}`:`${e}${Array(r-e.length+2).join("0")}`}var Yr={"%":(t,n)=>(t*100).toFixed(n),b:(t)=>Math.round(t).toString(2),c:(t)=>`${t}`,d:Dr,e:(t,n)=>t.toExponential(n),f:(t,n)=>t.toFixed(n),g:(t,n)=>t.toPrecision(n),o:(t)=>Math.round(t).toString(8),p:(t,n)=>li(t*100,n),r:li,s:jr,X:(t)=>Math.round(t).toString(16).toUpperCase(),x:(t)=>Math.round(t).toString(16)},ui=Yr;function fi(t){return t}var ci=Array.prototype.map,gi=["y","z","a","f","p","n","µ","m","","k","M","G","T","P","E","Z","Y"];function Hr(t){let n=t.grouping===void 0||t.thousands===void 0?fi:Ar(ci.call(t.grouping,Number),`${t.thousands}`),i=t.currency===void 0?"":t.currency[0]+"",e=t.currency===void 0?"":t.currency[1]+"",r=t.decimal===void 0?".":`${t.decimal}`,a=t.numerals===void 0?fi:Ur(ci.call(t.numerals,String)),s=t.percent===void 0?"%":`${t.percent}`,o=t.minus===void 0?"−":`${t.minus}`,l=t.nan===void 0?"NaN":`${t.nan}`;function h(f,y){let c=$n(f),_=c.fill,p=c.align,m=c.sign,u=c.symbol,d=c.zero,T=c.width,S=c.comma,D=c.precision,z=c.trim,$=c.type;if($==="n")S=!0,$="g";else if(!ui[$]){if(D===void 0)D=12;z=!0,$="g"}if(d||_==="0"&&p==="=")d=!0,_="0",p="=";let V=(y&&y.prefix!==void 0?y.prefix:"")+(u==="$"?i:u==="#"&&/[boxX]/.test($)?`0${$.toLowerCase()}`:""),bt=(u==="$"?e:/[%p]/.test($)?s:"")+(y&&y.suffix!==void 0?y.suffix:""),et=ui[$],Nt=/[defgprs%]/.test($);D=D===void 0?6:/[gprs]/.test($)?Math.max(1,Math.min(21,D)):Math.max(0,Math.min(20,D));function rt(M){let Y=V,v=bt,I,st,X;if($==="c")v=et(M)+v,M="";else{M=+M;let H=M<0||1/M<0;if(M=isNaN(M)?l:et(Math.abs(M),D),z)M=Pr(M);if(H&&+M===0&&m!=="+")H=!1;if(Y=(H?m==="("?m:o:m==="-"||m==="("?"":m)+Y,v=($==="s"&&!isNaN(M)&&Et!==void 0?gi[8+Et/3]:"")+v+(H&&m==="("?")":""),Nt){I=-1,st=M.length;while(++I<st)if(X=M.charCodeAt(I),48>X||X>57){v=(X===46?r+M.slice(I+1):M.slice(I))+v,M=M.slice(0,I);break}}}if(S&&!d)M=n(M,1/0);let at=Y.length+M.length+v.length,E=at<(T??0)?Array((T??0)-at+1).join(_):"";if(S&&d)M=n(E+M,E.length?(T??0)-v.length:1/0),E="";switch(p){case"<":M=Y+M+v+E;break;case"=":M=Y+E+M+v;break;case"^":{let H=E.length>>1;M=E.slice(0,H)+Y+M+v+E.slice(H);break}default:M=E+Y+M+v;break}return a(M)}return rt.toString=function(){return`${c}`},rt}function g(f,y){let c=$n(f);c.type="f";let _=Math.max(-8,Math.min(8,Math.floor(yt(y)/3)))*3,p=Math.pow(10,-_),m=h(`${c}`,{suffix:gi[8+_/3]});return function(u){return m(p*u)}}return{format:h,formatPrefix:g}}var jt,Ei,Di;Rr({thousands:",",grouping:[3],currency:["$",""]});function Rr(t){return jt=Hr(t),Ei=jt.format,Di=jt.formatPrefix,jt}function Ir(t){return Math.max(0,-yt(Math.abs(t)))}function zr(t,n){return Math.max(0,Math.max(-8,Math.min(8,Math.floor(yt(n)/3)))*3-yt(Math.abs(t)))}function qr(t,n){return t=Math.abs(t),n=Math.abs(n)-t,Math.max(0,yt(n)-yt(t))+1}function Zr(t,n,i,e){let r=Tn(t,n,i),a,s=$n(e==null?",f":e);switch(s.type){case"s":{let o=Math.max(Math.abs(t),Math.abs(n));if(s.precision==null&&!isNaN(a=zr(r,o)))s.precision=a;return Di(s.toString(),o)}case"":case"e":case"g":case"p":case"r":{if(s.precision==null&&!isNaN(a=qr(r,Math.max(Math.abs(t),Math.abs(n)))))s.precision=a-(s.type==="e"?1:0);break}case"f":case"%":{if(s.precision==null&&!isNaN(a=Ir(r)))s.precision=a-(s.type==="%"?1:0)*2;break}}return Ei(s.toString())}function Jr(t){let n=t.domain;return t.ticks=function(i){let e=n();return Be(e[0],e[e.length-1],i==null?10:i)},t.tickFormat=function(i,e){let r=n();return Zr(r[0],r[r.length-1],i==null?10:i,e)},t.nice=function(i){if(i==null)i=10;let e=n(),r=0,a=e.length-1,s=e[r],o=e[a],l,h,g=10;if(o<s)h=s,s=o,o=h,h=r,r=a,a=h;while(g-- >0){if(h=mn(s,o,i),h===l)return e[r]=s,e[a]=o,t.domain(e);else if(h>0)s=Math.floor(s/h)*h,o=Math.ceil(o/h)*h;else if(h<0)s=Math.ceil(s*h)/h,o=Math.floor(o*h)/h;else break;l=h}return t},t}function Xt(...t){let n=Er();return n.copy=function(){return Sr(n,Xt())},Ke.apply(n,arguments),Jr(n)}var xn=new Date,dn=new Date;function U(t,n,i,e){function r(a){let s=a==null?new Date:new Date(+a);return t(s),s}if(r.floor=(a)=>{let s=new Date(+a);return t(s),s},r.ceil=(a)=>{let s=new Date(+a-1);return t(s),n(s,1),t(s),s},r.round=(a)=>{let s=r(a),o=r.ceil(a);return+a-+s<+o-+a?s:o},r.offset=(a,s)=>{let o=new Date(+a);return n(o,s==null?1:Math.floor(s)),o},r.range=(a,s,o)=>{let l=[],h=r.ceil(a),g=o==null?1:Math.floor(o);if(!(h<new Date(+s))||!(g>0))return l;let f;do f=new Date(+h),l.push(f),n(h,g),t(h);while(f<h&&h<new Date(+s));return l},r.filter=(a)=>{return U((s)=>{if(s>=s)while(t(s),!a(s))s.setTime(+s-1)},(s,o)=>{if(s>=s)if(o<0)while(++o<=0)while(n(s,-1),!a(s));else while(--o>=0)while(n(s,1),!a(s));})},i)r.count=(a,s)=>{return xn.setTime(+a),dn.setTime(+s),t(xn),t(dn),Math.floor(i(xn,dn))},r.every=(a)=>{return a=Math.floor(a),!isFinite(a)||!(a>0)?null:!(a>1)?r:r.filter(e?(s)=>e(s)%a===0:(s)=>r.count(0,s)%a===0)};return r}var qt=U(()=>{},(t,n)=>{t.setTime(+t+n)},(t,n)=>{return+n-+t});qt.every=(t)=>{if(t=Math.floor(t),!isFinite(t)||!(t>0))return null;if(!(t>1))return qt;return U((n)=>{n.setTime(Math.floor(+n/t)*t)},(n,i)=>{n.setTime(+n+i*t)},(n,i)=>{return(+i-+n)/t})};var Pa=qt.range,B=1000,G=60000,K=3600000,xt=86400000,An=604800000,_i=2592000000,pn=31536000000,Ct=U((t)=>{t.setTime(+t-t.getMilliseconds())},(t,n)=>{t.setTime(+t+n*B)},(t,n)=>{return(+n-+t)/B},(t)=>{return t.getUTCSeconds()}),ja=Ct.range,Ai=U((t)=>{t.setTime(+t-t.getMilliseconds()-t.getSeconds()*B)},(t,n)=>{t.setTime(+t+n*G)},(t,n)=>{return(+n-+t)/G},(t)=>{return t.getMinutes()}),Ya=Ai.range,Ui=U((t)=>{t.setUTCSeconds(0,0)},(t,n)=>{t.setTime(+t+n*G)},(t,n)=>{return(+n-+t)/G},(t)=>{return t.getUTCMinutes()}),Ha=Ui.range,Oi=U((t)=>{t.setTime(+t-t.getMilliseconds()-t.getSeconds()*B-t.getMinutes()*G)},(t,n)=>{t.setTime(+t+n*K)},(t,n)=>{return(+n-+t)/K},(t)=>{return t.getHours()}),Ra=Oi.range,Fi=U((t)=>{t.setUTCMinutes(0,0,0)},(t,n)=>{t.setTime(+t+n*K)},(t,n)=>{return(+n-+t)/K},(t)=>{return t.getUTCHours()}),Ia=Fi.range,Gt=U((t)=>{t.setHours(0,0,0,0)},(t,n)=>{t.setDate(t.getDate()+n)},(t,n)=>(+n-+t-(n.getTimezoneOffset()-t.getTimezoneOffset())*G)/xt,(t)=>t.getDate()-1),za=Gt.range,Un=U((t)=>{t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCDate(t.getUTCDate()+n)},(t,n)=>{return(+n-+t)/xt},(t)=>{return t.getUTCDate()-1}),qa=Un.range,Pi=U((t)=>{t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCDate(t.getUTCDate()+n)},(t,n)=>{return(+n-+t)/xt},(t)=>{return Math.floor(+t/xt)}),Za=Pi.range;function ft(t){return U((n)=>{n.setDate(n.getDate()-(n.getDay()+7-t)%7),n.setHours(0,0,0,0)},(n,i)=>{n.setDate(n.getDate()+i*7)},(n,i)=>{return(+i-+n-(i.getTimezoneOffset()-n.getTimezoneOffset())*G)/An})}var On=ft(0),Zt=ft(1),Xr=ft(2),Gr=ft(3),dt=ft(4),Wr=ft(5),Lr=ft(6),Ja=On.range,Xa=Zt.range,Ga=Xr.range,Wa=Gr.range,La=dt.range,Va=Wr.range,Ba=Lr.range;function ct(t){return U((n)=>{n.setUTCDate(n.getUTCDate()-(n.getUTCDay()+7-t)%7),n.setUTCHours(0,0,0,0)},(n,i)=>{n.setUTCDate(n.getUTCDate()+i*7)},(n,i)=>{return(+i-+n)/An})}var Fn=ct(0),Jt=ct(1),Vr=ct(2),Br=ct(3),pt=ct(4),Kr=ct(5),Qr=ct(6),Ka=Fn.range,Qa=Jt.range,to=Vr.range,no=Br.range,io=pt.range,eo=Kr.range,ro=Qr.range,ji=U((t)=>{t.setDate(1),t.setHours(0,0,0,0)},(t,n)=>{t.setMonth(t.getMonth()+n)},(t,n)=>{return n.getMonth()-t.getMonth()+(n.getFullYear()-t.getFullYear())*12},(t)=>{return t.getMonth()}),so=ji.range,Yi=U((t)=>{t.setUTCDate(1),t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCMonth(t.getUTCMonth()+n)},(t,n)=>{return n.getUTCMonth()-t.getUTCMonth()+(n.getUTCFullYear()-t.getUTCFullYear())*12},(t)=>{return t.getUTCMonth()}),ao=Yi.range,tt=U((t)=>{t.setMonth(0,1),t.setHours(0,0,0,0)},(t,n)=>{t.setFullYear(t.getFullYear()+n)},(t,n)=>{return n.getFullYear()-t.getFullYear()},(t)=>{return t.getFullYear()});tt.every=(t)=>{return t=Math.floor(t),!isFinite(t)||!(t>0)?null:U((n)=>{n.setFullYear(Math.floor(n.getFullYear()/t)*t),n.setMonth(0,1),n.setHours(0,0,0,0)},(n,i)=>{n.setFullYear(n.getFullYear()+i*t)})};var oo=tt.range,nt=U((t)=>{t.setUTCMonth(0,1),t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCFullYear(t.getUTCFullYear()+n)},(t,n)=>{return n.getUTCFullYear()-t.getUTCFullYear()},(t)=>{return t.getUTCFullYear()});nt.every=(t)=>{return t=Math.floor(t),!isFinite(t)||!(t>0)?null:U((n)=>{n.setUTCFullYear(Math.floor(n.getUTCFullYear()/t)*t),n.setUTCMonth(0,1),n.setUTCHours(0,0,0,0)},(n,i)=>{n.setUTCFullYear(n.getUTCFullYear()+i*t)})};var ho=nt.range;function Hi(t,n,i,e,r,a){let s=[[Ct,1,B],[Ct,5,5*B],[Ct,15,15*B],[Ct,30,30*B],[a,1,G],[a,5,5*G],[a,15,15*G],[a,30,30*G],[r,1,K],[r,3,3*K],[r,6,6*K],[r,12,12*K],[e,1,xt],[e,2,2*xt],[i,1,An],[n,1,_i],[n,3,3*_i],[t,1,pn]];function o(h,g,f){let y=g<h;if(y)[h,g]=[g,h];let c=f&&typeof f.range==="function"?f:l(h,g,f),_=c?c.range(h,+g+1):[];return y?_.reverse():_}function l(h,g,f){let y=Math.abs(+g-+h)/f,c=vn(([,,m])=>m).right(s,y);if(c===s.length)return t.every(Tn(+h/pn,+g/pn,f));if(c===0)return qt.every(Math.max(Tn(+h,+g,f),1));let[_,p]=s[y/s[c-1][2]<s[c][2]/y?c-1:c];return _.every(p)}return[o,l]}var Ri=Hi(nt,Yi,Fn,Pi,Fi,Ui),Ii=Hi(tt,ji,On,Gt,Oi,Ai),lo=Ri[0],uo=Ri[1],fo=Ii[0],co=Ii[1];function Mn(t){if(0<=t.y&&t.y<100){let n=new Date(-1,t.m,t.d,t.H,t.M,t.S,t.L);return n.setFullYear(t.y),n}return new Date(t.y,t.m,t.d,t.H,t.M,t.S,t.L)}function wn(t){if(0<=t.y&&t.y<100){let n=new Date(Date.UTC(-1,t.m,t.d,t.H,t.M,t.S,t.L));return n.setUTCFullYear(t.y),n}return new Date(Date.UTC(t.y,t.m,t.d,t.H,t.M,t.S,t.L))}function $t(t,n,i){return{y:t,m:n,d:i,H:0,M:0,S:0,L:0}}function ts(t){let{dateTime:n,date:i,time:e,periods:r,days:a,shortDays:s,months:o,shortMonths:l}=t,h=vt(r),g=St(r),f=vt(a),y=St(a),c=vt(s),_=St(s),p=vt(o),m=St(o),u=vt(l),d=St(l),T={a:st,A:X,b:at,B:E,c:null,d:wi,e:wi,f:bs,g:Us,G:Fs,H:ws,I:ms,j:Ts,L:zi,m:Ns,M:ks,p:H,q:we,Q:bi,s:Ni,S:$s,u:vs,U:Ss,V:Cs,w:Es,W:Ds,x:null,X:null,y:As,Y:Os,Z:Ps,"%":Ti},S={a:me,A:Te,b:be,B:Ne,c:null,d:mi,e:mi,f:Rs,g:Vs,G:Ks,H:js,I:Ys,j:Hs,L:Zi,m:Is,M:zs,p:ke,q:$e,Q:bi,s:Ni,S:qs,u:Zs,U:Js,V:Xs,w:Gs,W:Ws,x:null,X:null,y:Ls,Y:Bs,Z:Qs,"%":Ti},D={a:et,A:Nt,b:rt,B:M,c:Y,d:pi,e:pi,f:xs,g:di,G:xi,H:Mi,I:Mi,j:cs,L:ys,m:fs,M:gs,p:bt,q:us,Q:ps,s:Ms,S:_s,u:ss,U:as,V:os,w:rs,W:hs,x:v,X:I,y:di,Y:xi,Z:ls,"%":ds};T.x=z(i,T),T.X=z(e,T),T.c=z(n,T),S.x=z(i,S),S.X=z(e,S),S.c=z(n,S);function z(w,b){return function(N){let x=[],q=-1,C=0,Z=w.length,J,ot,Gn;if(!(N instanceof Date))N=new Date(+N);while(++q<Z)if(w.charCodeAt(q)===37){if(x.push(w.slice(C,q)),(ot=yi[J=w.charAt(++q)])!=null)J=w.charAt(++q);else ot=J==="e"?" ":"0";if(Gn=b[J])J=Gn(N,ot);x.push(J),C=q+1}return x.push(w.slice(C,q)),x.join("")}}function $(w,b){return function(N){let x=$t(1900,void 0,1),q=V(x,w,N+="",0),C,Z;if(q!=N.length)return null;if("Q"in x)return new Date(x.Q);if("s"in x)return new Date(x.s*1000+("L"in x?x.L:0));if(b&&!("Z"in x))x.Z=0;if("p"in x)x.H=x.H%12+x.p*12;if(x.m===void 0)x.m="q"in x?x.q:0;if("V"in x){if(x.V<1||x.V>53)return null;if(!("w"in x))x.w=1;if("Z"in x)C=wn($t(x.y,0,1)),Z=C.getUTCDay(),C=Z>4||Z===0?Jt.ceil(C):Jt(C),C=Un.offset(C,(x.V-1)*7),x.y=C.getUTCFullYear(),x.m=C.getUTCMonth(),x.d=C.getUTCDate()+(x.w+6)%7;else C=Mn($t(x.y,0,1)),Z=C.getDay(),C=Z>4||Z===0?Zt.ceil(C):Zt(C),C=Gt.offset(C,(x.V-1)*7),x.y=C.getFullYear(),x.m=C.getMonth(),x.d=C.getDate()+(x.w+6)%7}else if("W"in x||"U"in x){if(!("w"in x))x.w="u"in x?x.u%7:("W"in x)?1:0;Z="Z"in x?wn($t(x.y,0,1)).getUTCDay():Mn($t(x.y,0,1)).getDay(),x.m=0,x.d="W"in x?(x.w+6)%7+x.W*7-(Z+5)%7:x.w+x.U*7-(Z+6)%7}if("Z"in x)return x.H+=x.Z/100|0,x.M+=x.Z%100,wn(x);return Mn(x)}}function V(w,b,N,x){let q=0,C=b.length,Z=N.length,J,ot;while(q<C){if(x>=Z)return-1;if(J=b.charCodeAt(q++),J===37){if(J=b.charAt(q++),ot=D[J in yi?b.charAt(q++):J],!ot||(x=ot(w,N,x))<0)return-1}else if(J!=N.charCodeAt(x++))return-1}return x}function bt(w,b,N){let x=h.exec(b.slice(N));return x?(w.p=g.get(x[0].toLowerCase()),N+x[0].length):-1}function et(w,b,N){let x=c.exec(b.slice(N));return x?(w.w=_.get(x[0].toLowerCase()),N+x[0].length):-1}function Nt(w,b,N){let x=f.exec(b.slice(N));return x?(w.w=y.get(x[0].toLowerCase()),N+x[0].length):-1}function rt(w,b,N){let x=u.exec(b.slice(N));return x?(w.m=d.get(x[0].toLowerCase()),N+x[0].length):-1}function M(w,b,N){let x=p.exec(b.slice(N));return x?(w.m=m.get(x[0].toLowerCase()),N+x[0].length):-1}function Y(w,b,N){return V(w,n,b,N)}function v(w,b,N){return V(w,i,b,N)}function I(w,b,N){return V(w,e,b,N)}function st(w){return s[w.getDay()]}function X(w){return a[w.getDay()]}function at(w){return l[w.getMonth()]}function E(w){return o[w.getMonth()]}function H(w){return r[+(w.getHours()>=12)]}function we(w){return 1+~~(w.getMonth()/3)}function me(w){return s[w.getUTCDay()]}function Te(w){return a[w.getUTCDay()]}function be(w){return l[w.getUTCMonth()]}function Ne(w){return o[w.getUTCMonth()]}function ke(w){return r[+(w.getUTCHours()>=12)]}function $e(w){return 1+~~(w.getUTCMonth()/3)}return{format(w){let b=z(w+="",T);return Object.assign(b,{toString(){return w}})},parse(w){let b=$(w+="",!1);return Object.assign(b,{toString(){return w}})},utcFormat(w){let b=z(w+="",S);return Object.assign(b,{toString(){return w}})},utcParse(w){let b=$(w+="",!0);return Object.assign(b,{toString(){return w}})}}}var yi={"-":"",_:" ","0":"0"},P=/^\s*\d+/,ns=/^%/,is=/[\\^$*+?|[\]().{}]/g;function k(t,n,i){let e=t<0?"-":"",r=`${e?-t:t}`,a=r.length;return e+(a<i?Array(i-a+1).join(n)+r:r)}function es(t){return t.replace(is,"\\$&")}function vt(t){return new RegExp(`^(?:${t.map(es).join("|")})`,"i")}function St(t){return new Map(t.map((n,i)=>[n.toLowerCase(),i]))}function rs(t,n,i){let e=P.exec(n.slice(i,i+1));return e?(t.w=+e[0],i+e[0].length):-1}function ss(t,n,i){let e=P.exec(n.slice(i,i+1));return e?(t.u=+e[0],i+e[0].length):-1}function as(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.U=+e[0],i+e[0].length):-1}function os(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.V=+e[0],i+e[0].length):-1}function hs(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.W=+e[0],i+e[0].length):-1}function xi(t,n,i){let e=P.exec(n.slice(i,i+4));return e?(t.y=+e[0],i+e[0].length):-1}function di(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.y=+e[0]+(+e[0]>68?1900:2000),i+e[0].length):-1}function ls(t,n,i){let e=/^(Z)|([+-]\d\d)(?::?(\d\d))?/.exec(n.slice(i,i+6));return e?(t.Z=e[1]?0:-+(e[2]+(e[3]||"00")),i+e[0].length):-1}function us(t,n,i){let e=P.exec(n.slice(i,i+1));return e?(t.q=+e[0]*3-3,i+e[0].length):-1}function fs(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.m=+e[0]-1,i+e[0].length):-1}function pi(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.d=+e[0],i+e[0].length):-1}function cs(t,n,i){let e=P.exec(n.slice(i,i+3));return e?(t.m=0,t.d=+e[0],i+e[0].length):-1}function Mi(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.H=+e[0],i+e[0].length):-1}function gs(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.M=+e[0],i+e[0].length):-1}function _s(t,n,i){let e=P.exec(n.slice(i,i+2));return e?(t.S=+e[0],i+e[0].length):-1}function ys(t,n,i){let e=P.exec(n.slice(i,i+3));return e?(t.L=+e[0],i+e[0].length):-1}function xs(t,n,i){let e=P.exec(n.slice(i,i+6));return e?(t.L=Math.floor(+e[0]/1000),i+e[0].length):-1}function ds(t,n,i){let e=ns.exec(n.slice(i,i+1));return e?i+e[0].length:-1}function ps(t,n,i){let e=P.exec(n.slice(i));return e?(t.Q=+e[0],i+e[0].length):-1}function Ms(t,n,i){let e=P.exec(n.slice(i));return e?(t.s=+e[0],i+e[0].length):-1}function wi(t,n){return k(t.getDate(),n,2)}function ws(t,n){return k(t.getHours(),n,2)}function ms(t,n){return k(t.getHours()%12||12,n,2)}function Ts(t,n){return k(1+Gt.count(tt(t),t),n,3)}function zi(t,n){return k(t.getMilliseconds(),n,3)}function bs(t,n){return`${zi(t,n)}000`}function Ns(t,n){return k(t.getMonth()+1,n,2)}function ks(t,n){return k(t.getMinutes(),n,2)}function $s(t,n){return k(t.getSeconds(),n,2)}function vs(t){let n=t.getDay();return n===0?7:n}function Ss(t,n){return k(On.count(tt(t).getTime()-1,t),n,2)}function qi(t){let n=t.getDay();return n>=4||n===0?dt(t):dt.ceil(t)}function Cs(t,n){return t=qi(t),k(dt.count(tt(t),t)+(tt(t).getDay()===4?1:0),n,2)}function Es(t){return t.getDay()}function Ds(t,n){return k(Zt.count(tt(t).getTime()-1,t),n,2)}function As(t,n){return k(t.getFullYear()%100,n,2)}function Us(t,n){return t=qi(t),k(t.getFullYear()%100,n,2)}function Os(t,n){return k(t.getFullYear()%1e4,n,4)}function Fs(t,n){let i=t.getDay();return t=i>=4||i===0?dt(t):dt.ceil(t),k(t.getFullYear()%1e4,n,4)}function Ps(t){let n=t.getTimezoneOffset();return(n>0?"-":(n*=-1,"+"))+k(n/60|0,"0",2)+k(n%60,"0",2)}function mi(t,n){return k(t.getUTCDate(),n,2)}function js(t,n){return k(t.getUTCHours(),n,2)}function Ys(t,n){return k(t.getUTCHours()%12||12,n,2)}function Hs(t,n){return k(1+Un.count(nt(t),t),n,3)}function Zi(t,n){return k(t.getUTCMilliseconds(),n,3)}function Rs(t,n){return`${Zi(t,n)}000`}function Is(t,n){return k(t.getUTCMonth()+1,n,2)}function zs(t,n){return k(t.getUTCMinutes(),n,2)}function qs(t,n){return k(t.getUTCSeconds(),n,2)}function Zs(t){let n=t.getUTCDay();return n===0?7:n}function Js(t,n){return k(Fn.count(nt(t).getTime()-1,t),n,2)}function Ji(t){let n=t.getUTCDay();return n>=4||n===0?pt(t):pt.ceil(t)}function Xs(t,n){return t=Ji(t),k(pt.count(nt(t),t)+(nt(t).getUTCDay()===4?1:0),n,2)}function Gs(t){return t.getUTCDay()}function Ws(t,n){return k(Jt.count(nt(t).getTime()-1,t),n,2)}function Ls(t,n){return k(t.getUTCFullYear()%100,n,2)}function Vs(t,n){return t=Ji(t),k(t.getUTCFullYear()%100,n,2)}function Bs(t,n){return k(t.getUTCFullYear()%1e4,n,4)}function Ks(t,n){let i=t.getUTCDay();return t=i>=4||i===0?pt(t):pt.ceil(t),k(t.getUTCFullYear()%1e4,n,4)}function Qs(){return"+0000"}function Ti(){return"%"}function bi(t){return+t}function Ni(t){return Math.floor(+t/1000)}var gt,ta,na,ia,ea;ra({dateTime:"%x, %X",date:"%-m/%-d/%Y",time:"%-I:%M:%S %p",periods:["AM","PM"],days:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],shortDays:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],months:["January","February","March","April","May","June","July","August","September","October","November","December"],shortMonths:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]});function ra(t){return gt=ts(t),ta=gt.format,na=gt.parse,ia=gt.utcFormat,ea=gt.utcParse,gt}function j(t){return function(){return t}}var{abs:_o,atan2:yo,cos:sa,max:xo,min:po,sin:jn,sqrt:mt}=Math,Xi=0.000000000001,Wt=Math.PI,Mo=Wt/2,Bi=2*Wt;var Yn=Math.PI,Hn=2*Yn,aa=Hn-0.000001;function Ki(t,...n){this._+=t[0];for(let i=1,e=t.length;i<e;++i)this._+=n[i-1]+t[i]}function oa(t){let n=Math.floor(t);if(!(n>=0))throw Error(`invalid digits: ${t}`);if(n>15)return Ki;let i=10**n;return function(e,...r){this._+=e[0];for(let a=1,s=e.length;a<s;++a)this._+=Math.round(r[a-1]*i)/i+e[a]}}class Lt{_x0;_y0;_x1;_y1;_;_append;constructor(t){this._x0=this._y0=this._x1=this._y1=null,this._="",this._append=t==null?Ki:oa(t)}moveTo(t,n){this._append`M${this._x0=this._x1=+t},${this._y0=this._y1=+n}`}closePath(){if(this._x1!==null)this._x1=this._x0,this._y1=this._y0,this._append`Z`}lineTo(t,n){this._append`L${this._x1=+t},${this._y1=+n}`}quadraticCurveTo(t,n,i,e){this._append`Q${+t},${+n},${this._x1=+i},${this._y1=+e}`}bezierCurveTo(t,n,i,e,r,a){this._append`C${+t},${+n},${+i},${+e},${this._x1=+r},${this._y1=+a}`}arcTo(t,n,i,e,r){if(t=+t,n=+n,i=+i,e=+e,r=+r,r<0)throw Error(`negative radius: ${r}`);let a=this._x1,s=this._y1,o=i-t,l=e-n,h=a-t,g=s-n,f=h*h+g*g;if(this._x1===null)this._append`M${this._x1=t},${this._y1=n}`;else if(!(f>0.000001));else if(!(Math.abs(g*o-l*h)>0.000001)||!r)this._append`L${this._x1=t},${this._y1=n}`;else{let y=i-a,c=e-s,_=o*o+l*l,p=y*y+c*c,m=Math.sqrt(_),u=Math.sqrt(f),d=r*Math.tan((Yn-Math.acos((_+f-p)/(2*m*u)))/2),T=d/u,S=d/m;if(Math.abs(T-1)>0.000001)this._append`L${t+T*h},${n+T*g}`;this._append`A${r},${r},0,0,${+(g*y>h*c)},${this._x1=t+S*o},${this._y1=n+S*l}`}}arc(t,n,i,e,r,a){if(t=+t,n=+n,i=+i,a=!!a,i<0)throw Error(`negative radius: ${i}`);let s=i*Math.cos(e),o=i*Math.sin(e),l=t+s,h=n+o,g=1^a,f=a?e-r:r-e;if(this._x1===null)this._append`M${l},${h}`;else if(Math.abs(this._x1-l)>0.000001||Math.abs(this._y1-h)>0.000001)this._append`L${l},${h}`;if(!i)return;if(f<0)f=f%Hn+Hn;if(f>aa)this._append`A${i},${i},0,1,${g},${t-s},${n-o}A${i},${i},0,1,${g},${this._x1=l},${this._y1=h}`;else if(f>0.000001)this._append`A${i},${i},0,${+(f>=Yn)},${g},${this._x1=t+i*Math.cos(r)},${this._y1=n+i*Math.sin(r)}`}rect(t,n,i,e){this._append`M${this._x0=this._x1=+t},${this._y0=this._y1=+n}h${i=+i}v${+e}h${-i}Z`}toString(){return this._}}function ha(){return new Lt}Object.defineProperty(ha,Symbol.hasInstance,{value:(t)=>t instanceof Lt});function Qi(t){let n=3;return t.digits=function(i){if(!arguments.length)return n;if(i==null)n=null;else{let e=Math.floor(i);if(!(e>=0))throw RangeError(`invalid digits: ${i}`);n=e}return t},()=>new Lt(n)}var wo=Array.prototype.slice;function te(t){return typeof t==="object"&&"length"in t?t:Array.from(t)}function ne(t){this._context=t}Object.assign(ne.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._point=0},lineEnd(){if(this._line||this._line!==0&&this._point===1)this._context.closePath();this._line=1-this._line},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1,this._line?this._context.lineTo(t,n):this._context.moveTo(t,n);break;case 1:this._point=2,this._context.lineTo(t,n);break;default:this._context.lineTo(t,n);break}}});function Rn(t){return new ne(t)}function ie(t){return t[0]}function ee(t){return t[1]}function In(t,n){let i=j(!0),e=null,r=Rn,a=null,s=Qi(o);t=typeof t==="function"?t:t===void 0?ie:j(t),n=typeof n==="function"?n:n===void 0?ee:j(n);function o(l){let h,g=(l=te(l)).length,f,y=!1,c;if(e==null)a=r(c=s());for(h=0;h<=g;++h){if(!(h<g&&i(f=l[h],h,l))===y)if(y=!y)a.lineStart();else a.lineEnd();if(y)a.point(+t(f,h,l),+n(f,h,l))}if(c)return a=null,c+""||null}return o.x=function(l){return arguments.length?(t=typeof l==="function"?l:j(+l),o):t},o.y=function(l){return arguments.length?(n=typeof l==="function"?l:j(+l),o):n},o.defined=function(l){return arguments.length?(i=typeof l==="function"?l:j(!!l),o):i},o.curve=function(l){return arguments.length?(r=l,e!=null&&(a=r(e)),o):r},o.context=function(l){return arguments.length?(l==null?e=a=null:a=r(e=l),o):e},o}function re(t,n,i){let e=null,r=j(!0),a=null,s=Rn,o=null,l=Qi(h);t=typeof t==="function"?t:t===void 0?ie:j(+t),n=typeof n==="function"?n:n===void 0?j(0):j(+n),i=typeof i==="function"?i:i===void 0?ee:j(+i);function h(f){let y,c=0,_,p=(f=te(f)).length,m,u=!1,d,T=Array(p),S=Array(p);if(a==null)o=s(d=l());for(y=0;y<=p;++y){if(!(y<p&&r(m=f[y],y,f))===u)if(u=!u)c=y,o.areaStart(),o.lineStart();else{o.lineEnd(),o.lineStart();for(_=y-1;_>=c;--_)o.point(T[_],S[_]);o.lineEnd(),o.areaEnd()}if(u)T[y]=+t(m,y,f),S[y]=+n(m,y,f),o.point(e?+e(m,y,f):T[y],i?+i(m,y,f):S[y])}if(d)return o=null,`${d}`||null}function g(){return In().defined(r).curve(s).context(a)}return h.x=function(f){return arguments.length?(t=typeof f==="function"?f:j(+f),e=null,h):t},h.x0=function(f){return arguments.length?(t=typeof f==="function"?f:j(+f),h):t},h.x1=function(f){return arguments.length?(e=f==null?null:typeof f==="function"?f:j(+f),h):e},h.y=function(f){return arguments.length?(n=typeof f==="function"?f:j(+f),i=null,h):n},h.y0=function(f){return arguments.length?(n=typeof f==="function"?f:j(+f),h):n},h.y1=function(f){return arguments.length?(i=f==null?null:typeof f==="function"?f:j(+f),h):i},h.lineX0=h.lineY0=function(){return g().x(t).y(n)},h.lineY1=function(){return g().x(t).y(i)},h.lineX1=function(){return g().x(e).y(n)},h.defined=function(f){return arguments.length?(r=typeof f==="function"?f:j(!!f),h):r},h.curve=function(f){return arguments.length?(s=f,a!=null&&(o=s(a)),h):s},h.context=function(f){return arguments.length?(f==null?a=o=null:o=s(a=f),h):a},h}function se(t){this._curve=t}Object.assign(se.prototype,{areaStart(){this._curve.areaStart()},areaEnd(){this._curve.areaEnd()},lineStart(){this._curve.lineStart()},lineEnd(){this._curve.lineEnd()},point(t,n){this._curve.point(n*Math.sin(t),n*-Math.cos(t))}});function la(t){function n(i){return new se(t(i))}return n._curve=t,n}var mo=la(Rn);var To=mt(3);var ua=mt(0.3333333333333333),bo=ua*2;var ae=jn(Wt/10)/jn(7*Wt/10),No=jn(Bi/10)*ae,ko=-sa(Bi/10)*ae;var $o=mt(3);var vo=mt(3);var So=mt(3)/2,fa=1/mt(12),Co=(fa/2+1)*3;function it(){}function Mt(t,n,i){t._context.bezierCurveTo((2*t._x0+t._x1)/3,(2*t._y0+t._y1)/3,(t._x0+2*t._x1)/3,(t._y0+2*t._y1)/3,(t._x0+4*t._x1+n)/6,(t._y0+4*t._y1+i)/6)}function zn(t){this._context=t}Object.assign(zn.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd(){switch(this._point){case 3:Mt(this,this._x1,this._y1),this._context.lineTo(this._x1,this._y1);break;case 2:this._context.lineTo(this._x1,this._y1);break}if(this._line||this._line!==0&&this._point===1)this._context.closePath();this._line=1-this._line},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1,this._line?this._context.lineTo(t,n):this._context.moveTo(t,n);break;case 1:this._point=2;break;case 2:this._point=3,this._context.lineTo((5*this._x0+this._x1)/6,(5*this._y0+this._y1)/6),Mt(this,t,n);break;default:Mt(this,t,n);break}this._x0=this._x1,this._x1=t,this._y0=this._y1,this._y1=n}});function ca(t){this._context=t}Object.assign(ca.prototype,{areaStart:it,areaEnd:it,lineStart(){this._x0=this._x1=this._x2=this._x3=this._x4=this._y0=this._y1=this._y2=this._y3=this._y4=NaN,this._point=0},lineEnd(){switch(this._point){case 1:{this._context.moveTo(this._x2,this._y2),this._context.closePath();break}case 2:{this._context.moveTo((this._x2+2*this._x3)/3,(this._y2+2*this._y3)/3),this._context.lineTo((this._x3+2*this._x2)/3,(this._y3+2*this._y2)/3),this._context.closePath();break}case 3:{this.point(this._x2,this._y2),this.point(this._x3,this._y3),this.point(this._x4,this._y4);break}}},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1,this._x2=t,this._y2=n;break;case 1:this._point=2,this._x3=t,this._y3=n;break;case 2:this._point=3,this._x4=t,this._y4=n,this._context.moveTo((this._x0+4*this._x1+t)/6,(this._y0+4*this._y1+n)/6);break;default:Mt(this,t,n);break}this._x0=this._x1,this._x1=t,this._y0=this._y1,this._y1=n}});function ga(t){this._context=t}Object.assign(ga.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd(){if(this._line||this._line!==0&&this._point===3)this._context.closePath();this._line=1-this._line},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3;{let i=(this._x0+4*this._x1+t)/6,e=(this._y0+4*this._y1+n)/6;this._line?this._context.lineTo(i,e):this._context.moveTo(i,e);break}case 3:this._point=4,Mt(this,t,n);break;default:Mt(this,t,n);break}this._x0=this._x1,this._x1=t,this._y0=this._y1,this._y1=n}});function oe(t,n){this._basis=new zn(t),this._beta=n}Object.assign(oe.prototype,{lineStart(){this._x=[],this._y=[],this._basis.lineStart()},lineEnd(){let t=this._x,n=this._y,i=t.length-1;if(i>0){let e=t[0],r=n[0],a=t[i]-e,s=n[i]-r,o=-1,l;while(++o<=i)l=o/i,this._basis.point(this._beta*t[o]+(1-this._beta)*(e+l*a),this._beta*n[o]+(1-this._beta)*(r+l*s))}this._x=this._y=null,this._basis.lineEnd()},point(t,n){this._x.push(+t),this._y.push(+n)}});var Eo=function t(n){function i(e){return n===1?new zn(e):new oe(e,n)}return i.beta=function(e){return t(+e)},i}(0.85);function wt(t,n,i){t._context.bezierCurveTo(t._x1+t._k*(t._x2-t._x0),t._y1+t._k*(t._y2-t._y0),t._x2+t._k*(t._x1-n),t._y2+t._k*(t._y1-i),t._x2,t._y2)}function qn(t,n){this._context=t,this._k=(1-n)/6}Object.assign(qn.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._point=0},lineEnd(){switch(this._point){case 2:this._context.lineTo(this._x2,this._y2);break;case 3:wt(this,this._x1,this._y1);break}if(this._line||this._line!==0&&this._point===1)this._context.closePath();this._line=1-this._line},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1,this._line?this._context.lineTo(t,n):this._context.moveTo(t,n);break;case 1:this._point=2,this._x1=t,this._y1=n;break;case 2:this._point=3,wt(this,t,n);break;default:wt(this,t,n);break}this._x0=this._x1,this._x1=this._x2,this._x2=t,this._y0=this._y1,this._y1=this._y2,this._y2=n}});var Do=function t(n){function i(e){return new qn(e,n)}return i.tension=function(e){return t(+e)},i}(0);function Zn(t,n){this._context=t,this._k=(1-n)/6}Object.assign(Zn.prototype,{areaStart:it,areaEnd:it,lineStart(){this._x0=this._x1=this._x2=this._x3=this._x4=this._x5=this._y0=this._y1=this._y2=this._y3=this._y4=this._y5=NaN,this._point=0},lineEnd(){switch(this._point){case 1:{this._context.moveTo(this._x3,this._y3),this._context.closePath();break}case 2:{this._context.lineTo(this._x3,this._y3),this._context.closePath();break}case 3:{this.point(this._x3,this._y3),this.point(this._x4,this._y4),this.point(this._x5,this._y5);break}}},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1,this._x3=t,this._y3=n;break;case 1:this._point=2,this._context.moveTo(this._x4=t,this._y4=n);break;case 2:this._point=3,this._x5=t,this._y5=n;break;default:wt(this,t,n);break}this._x0=this._x1,this._x1=this._x2,this._x2=t,this._y0=this._y1,this._y1=this._y2,this._y2=n}});var Ao=function t(n){function i(e){return new Zn(e,n)}return i.tension=function(e){return t(+e)},i}(0);function Jn(t,n){this._context=t,this._k=(1-n)/6}Object.assign(Jn.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._point=0},lineEnd(){if(this._line||this._line!==0&&this._point===3)this._context.closePath();this._line=1-this._line},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3,this._line?this._context.lineTo(this._x2,this._y2):this._context.moveTo(this._x2,this._y2);break;case 3:this._point=4,wt(this,t,n);break;default:wt(this,t,n);break}this._x0=this._x1,this._x1=this._x2,this._x2=t,this._y0=this._y1,this._y1=this._y2,this._y2=n}});var Uo=function t(n){function i(e){return new Jn(e,n)}return i.tension=function(e){return t(+e)},i}(0);function Dt(t,n,i){let{_x1:e,_y1:r,_x2:a,_y2:s}=t;if(t._l01_a>Xi){let o=2*t._l01_2a+3*t._l01_a*t._l12_a+t._l12_2a,l=3*t._l01_a*(t._l01_a+t._l12_a);e=(e*o-t._x0*t._l12_2a+t._x2*t._l01_2a)/l,r=(r*o-t._y0*t._l12_2a+t._y2*t._l01_2a)/l}if(t._l23_a>Xi){let o=2*t._l23_2a+3*t._l23_a*t._l12_a+t._l12_2a,l=3*t._l23_a*(t._l23_a+t._l12_a);a=(a*o+t._x1*t._l23_2a-n*t._l12_2a)/l,s=(s*o+t._y1*t._l23_2a-i*t._l12_2a)/l}t._context.bezierCurveTo(e,r,a,s,t._x2,t._y2)}function he(t,n){this._context=t,this._alpha=n}Object.assign(he.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd(){switch(this._point){case 2:this._context.lineTo(this._x2,this._y2);break;case 3:this.point(this._x2,this._y2);break}if(this._line||this._line!==0&&this._point===1)this._context.closePath();this._line=1-this._line},point(t,n){if(t=+t,n=+n,this._point){let i=this._x2-t,e=this._y2-n;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(i*i+e*e,this._alpha))}switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(t,n):this._context.moveTo(t,n);break;case 1:this._point=2;break;case 2:this._point=3,Dt(this,t,n);break;default:Dt(this,t,n);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=t,this._y0=this._y1,this._y1=this._y2,this._y2=n}});var Oo=function t(n){function i(e){return n?new he(e,n):new qn(e,0)}return i.alpha=function(e){return t(+e)},i}(0.5);function le(t,n){this._context=t,this._alpha=n}Object.assign(le.prototype,{areaStart:it,areaEnd:it,lineStart(){this._x0=this._x1=this._x2=this._x3=this._x4=this._x5=this._y0=this._y1=this._y2=this._y3=this._y4=this._y5=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd(){switch(this._point){case 1:{this._context.moveTo(this._x3,this._y3),this._context.closePath();break}case 2:{this._context.lineTo(this._x3,this._y3),this._context.closePath();break}case 3:{this.point(this._x3,this._y3),this.point(this._x4,this._y4),this.point(this._x5,this._y5);break}}},point(t,n){if(t=+t,n=+n,this._point){let i=this._x2-t,e=this._y2-n;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(i*i+e*e,this._alpha))}switch(this._point){case 0:this._point=1,this._x3=t,this._y3=n;break;case 1:this._point=2,this._context.moveTo(this._x4=t,this._y4=n);break;case 2:this._point=3,this._x5=t,this._y5=n;break;default:Dt(this,t,n);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=t,this._y0=this._y1,this._y1=this._y2,this._y2=n}});var Fo=function t(n){function i(e){return n?new le(e,n):new Zn(e,0)}return i.alpha=function(e){return t(+e)},i}(0.5);function ue(t,n){this._context=t,this._alpha=n}Object.assign(ue.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd(){if(this._line||this._line!==0&&this._point===3)this._context.closePath();this._line=1-this._line},point(t,n){if(t=+t,n=+n,this._point){let i=this._x2-t,e=this._y2-n;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(i*i+e*e,this._alpha))}switch(this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3,this._line?this._context.lineTo(this._x2,this._y2):this._context.moveTo(this._x2,this._y2);break;case 3:this._point=4,Dt(this,t,n);break;default:Dt(this,t,n);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=t,this._y0=this._y1,this._y1=this._y2,this._y2=n}});var Po=function t(n){function i(e){return n?new ue(e,n):new Jn(e,0)}return i.alpha=function(e){return t(+e)},i}(0.5);function _a(t){this._context=t}Object.assign(_a.prototype,{areaStart:it,areaEnd:it,lineStart(){this._point=0},lineEnd(){if(this._point)this._context.closePath()},point(t,n){if(t=+t,n=+n,this._point)this._context.lineTo(t,n);else this._point=1,this._context.moveTo(t,n)}});function Gi(t){return t<0?-1:1}function Wi(t,n,i){let e=t._x1-t._x0,r=n-t._x1,a=(t._y1-t._y0)/(e||(r<0?-0:0)),s=(i-t._y1)/(r||(e<0?-0:0)),o=(a*r+s*e)/(e+r);return(Gi(a)+Gi(s))*Math.min(Math.abs(a),Math.abs(s),0.5*Math.abs(o))||0}function Li(t,n){let i=t._x1-t._x0;return i?(3*(t._y1-t._y0)/i-n)/2:n}function Pn(t,n,i){let{_x0:e,_y0:r,_x1:a,_y1:s}=t,o=(a-e)/3;t._context.bezierCurveTo(e+o,r+o*n,a-o,s-o*i,a,s)}function Vt(t){this._context=t}Object.assign(Vt.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x0=this._x1=this._y0=this._y1=this._t0=NaN,this._point=0},lineEnd(){switch(this._point){case 2:this._context.lineTo(this._x1,this._y1);break;case 3:Pn(this,this._t0,Li(this,this._t0));break}if(this._line||this._line!==0&&this._point===1)this._context.closePath();this._line=1-this._line},point(t,n){let i=NaN;if(t=+t,n=+n,t===this._x1&&n===this._y1)return;switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(t,n):this._context.moveTo(t,n);break;case 1:this._point=2;break;case 2:this._point=3,Pn(this,Li(this,i=Wi(this,t,n)),i);break;default:Pn(this,this._t0,i=Wi(this,t,n));break}this._x0=this._x1,this._x1=t,this._y0=this._y1,this._y1=n,this._t0=i}});function fe(t){this._context=new ce(t)}fe.prototype=Object.create(Vt.prototype);fe.prototype.point=function(t,n){Vt.prototype.point.call(this,n,t)};function ce(t){this._context=t}Object.assign(ce.prototype,{moveTo(t,n){this._context.moveTo(n,t)},closePath(){this._context.closePath()},lineTo(t,n){this._context.lineTo(n,t)},bezierCurveTo(t,n,i,e,r,a){this._context.bezierCurveTo(n,t,e,i,a,r)}});function Xn(t){return new Vt(t)}function ya(t){this._context=t}Object.assign(ya.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x=[],this._y=[]},lineEnd(){let t=this._x,n=this._y,i=t.length;if(i)if(this._line?this._context.lineTo(t[0],n[0]):this._context.moveTo(t[0],n[0]),i===2)this._context.lineTo(t[1],n[1]);else{let e=Vi(t),r=Vi(n);for(let a=0,s=1;s<i;++a,++s)this._context.bezierCurveTo(e[0][a],r[0][a],e[1][a],r[1][a],t[s],n[s])}if(this._line||this._line!==0&&i===1)this._context.closePath();this._line=1-this._line,this._x=this._y=null},point(t,n){this._x.push(+t),this._y.push(+n)}});function Vi(t){let n,i=t.length-1,e,r=Array(i),a=Array(i),s=Array(i);r[0]=0,a[0]=2,s[0]=t[0]+2*t[1];for(n=1;n<i-1;++n)r[n]=1,a[n]=4,s[n]=4*t[n]+2*t[n+1];r[i-1]=2,a[i-1]=7,s[i-1]=8*t[i-1]+t[i];for(n=1;n<i;++n)e=r[n]/a[n-1],a[n]-=e,s[n]-=e*s[n-1];r[i-1]=s[i-1]/a[i-1];for(n=i-2;n>=0;--n)r[n]=(s[n]-r[n+1])/a[n];a[i-1]=(t[i]+r[i-1])/2;for(n=0;n<i-1;++n)a[n]=2*t[n+1]-r[n+1];return[r,a]}function xa(t,n){this._context=t,this._t=n}Object.assign(xa.prototype,{areaStart(){this._line=0},areaEnd(){this._line=NaN},lineStart(){this._x=this._y=NaN,this._point=0},lineEnd(){if(0<this._t&&this._t<1&&this._point===2)this._context.lineTo(this._x,this._y);if(this._line||this._line!==0&&this._point===1)this._context.closePath();if(this._line>=0)this._t=1-this._t,this._line=1-this._line},point(t,n){switch(t=+t,n=+n,this._point){case 0:this._point=1,this._line?this._context.lineTo(t,n):this._context.moveTo(t,n);break;case 1:{if(this._point=2,this._t<=0)this._context.lineTo(this._x,n),this._context.lineTo(t,n);else{let i=this._x*(1-this._t)+t*this._t;this._context.lineTo(i,this._y),this._context.lineTo(i,n)}break}default:{if(this._t<=0)this._context.lineTo(this._x,n),this._context.lineTo(t,n);else{let i=this._x*(1-this._t)+t*this._t;this._context.lineTo(i,this._y),this._context.lineTo(i,n)}break}}this._x=t,this._y=n}});var da=5,At={width:720,height:260,top:12,right:12,bottom:26,left:52};function L(t,n){if(n==="Other")return"var(--series-other)";return`var(--series-${t%da+1})`}function O(t){if(!Number.isFinite(t))return"0";let n=Math.abs(t);if(n>=1e9)return`${ht(".1f")(t/1e9)}B`;if(n>=1e6)return`${ht(".1f")(t/1e6)}M`;if(n>=1e4)return`${ht(".1f")(t/1000)}k`;if(n>=1000)return ht(",")(Math.round(t));if(Number.isInteger(t))return String(t);return ht(".2f")(t)}function _e(t,n="USD"){return new Intl.NumberFormat("en-US",{style:"currency",currency:n,maximumFractionDigits:Math.abs(t)>=1000?0:2}).format(t)}function ye(t){if(t===null)return"-";let n=t*100,i=Math.abs(n)>=100?Math.round(n):Math.round(n*10)/10;return`${t>=0?"+":""}${i}%`}function Bt(t,n=At){let i=n.width-n.left-n.right,e=n.height-n.top-n.bottom,r=t.series[0]?.points.length??0,a=Math.max(1,...t.series.flatMap((l)=>l.points.map((h)=>h.value))),s=Xt().domain([0,Math.max(1,r-1)]).range([n.left,n.left+i]),o=Xt().domain([0,ge(a)]).range([n.top+e,n.top]);return{x:s,y:o,yMax:ge(a),innerWidth:i,innerHeight:e,box:n}}function ge(t){if(t<=0)return 1;let n=10**Math.floor(Math.log10(t)),i=t/n;return(i<=1?1:i<=2?2:i<=5?5:10)*n}function Kt(t,n,i=4){let e=n.yMax/i;return Array.from({length:i+1},(r,a)=>{let s=e*a;return{value:s,y:n.y(s),label:O(s)}})}function Qt(t,n,i){let e=t.series[0]?.points??[];if(e.length===0)return[];let r=64,a=Math.max(2,Math.floor(n.innerWidth/r)),s=Math.max(1,Math.ceil(e.length/a)),o=[];for(let l=0;l<e.length;l+=s)o.push({x:n.x(l),label:i(e[l].t)});return o}function tn(t,n){let i=new Date(t);if(n==="month")return new Intl.DateTimeFormat("en-GB",{month:"short",year:"2-digit",timeZone:"UTC"}).format(i);if(n==="hour")return new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"}).format(i);return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",timeZone:"UTC"}).format(i)}function Tt(t,n){let i=new Date(t);if(n==="hour")return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"}).format(i);return new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(i)}function xe(t,n){let i=In().x((e,r)=>n.x(r)).y((e)=>n.y(e.value)).curve(Xn);return String(i(t.points)??"")}function de(t,n){let i=re().x((e,r)=>n.x(r)).y0(n.box.top+n.innerHeight).y1((e)=>n.y(e.value)).curve(Xn);return String(i(t.points)??"")}function pe(t,n,i=0){let e=t.series[i];if(!e)return[];let r=e.points.length,a=n.innerWidth/Math.max(1,r),s=Math.max(1,a-2),o=n.box.top+n.innerHeight;return e.points.map((l,h)=>{let g=n.y(l.value);return{x:n.box.left+h*a+1,y:g,width:s,height:Math.max(l.value>0?1:0,o-g),value:l.value,label:l.t}})}function Me(t,n=90,i=28){let e=t.series.reduce((o,l)=>o+l.total,0);if(e<=0)return[];let r=[...t.series].sort((o,l)=>l.total-o.total),a=0.02,s=-Math.PI/2;return r.map((o,l)=>{let h=o.total/e,g=s+h*Math.PI*2,y={path:pa(s+a/2,Math.max(s+a/2,g-a/2),n,n-i),value:o.total,key:o.key,color:L(l,o.key),percent:h};return s=g,y})}function pa(t,n,i,e){let r=n-t>Math.PI?1:0,a=(_,p)=>[_*Math.cos(p),_*Math.sin(p)],[s,o]=a(i,t),[l,h]=a(i,n),[g,f]=a(e,n),[y,c]=a(e,t);return[`M${s.toFixed(2)},${o.toFixed(2)}`,`A${i},${i} 0 ${r} 1 ${l.toFixed(2)},${h.toFixed(2)}`,`L${g.toFixed(2)},${f.toFixed(2)}`,`A${e},${e} 0 ${r} 0 ${y.toFixed(2)},${c.toFixed(2)}`,"Z"].join(" ")}class nn extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s,height:o=260}=this._props(),l={...At,height:o},h=Bt(a,l),g=Kt(a,h),f=Qt(a,h,(d)=>tn(d,a.grain)),y=pe(a,h).map((d)=>({...d,display:O(d.value),when:Tt(d.label,a.grain)})),c=L(0,a.series[0]?.key),_=y.every((d)=>d.value===0),p=[],m="No data in this range",u="";if(u+=`<figure class="flex flex-col h-full m-0">
        `,s)u+=`
          <figcaption class="mb-3 text-sm font-medium text-ink">`,u+=n(s),u+=`</figcaption>
        `;if(_)u+=`
          <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
            <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
            <p class="text-sm text-muted">`,u+=n("No data in this range"),u+=`</p>
            <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
          </div>
        `;else{u+=`<div class="flex-1 min-h-0">
        <svg viewBox="0 0 `,u+=n(l.width),u+=" ",u+=n(l.height),u+='" class="w-full h-full" role="img" aria-label="',u+=n(s??"Bar chart"),u+=`" preserveAspectRatio="none">
          `;for(let d of e(g))u+=`
            <line x1="`,u+=n(l.left),u+='" x2="',u+=n(l.width-l.right),u+='" y1="',u+=n(d.y),u+='" y2="',u+=n(d.y),u+=`" stroke="var(--grid)" stroke-width="1" />
            <text x="`,u+=n(l.left-8),u+='" y="',u+=n(d.y+4),u+='" text-anchor="end" class="chart-tick">',u+=n(d.label),u+=`</text>
          `;for(let d of e(f))u+=`
            <text x="`,u+=n(d.x),u+='" y="',u+=n(l.height-8),u+='" text-anchor="middle" class="chart-tick">',u+=n(d.label),u+=`</text>
          `;for(let d of e(y))u+=`
        
            <rect
              x="`,u+=n(d.x),u+='" y="',u+=n(d.y),u+=`"
              width="`,u+=n(d.width),u+='" height="',u+=n(d.height),u+=`"
              rx="4"
              fill="`,u+=n(c),u+=`"
              class="chart-bar"
            >
              <title>`,u+=n(d.when),u+=": ",u+=n(d.display),u+=`</title>
            </rect>
          `;if(u+=`</svg>
          </div>

          `,p.length>1){u+=`
        
            <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
              `;for(let d of e(p)){if(u+=`
                <li class="flex gap-2 items-center text-xs text-muted">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,u+=n(d.color),u+=`"></span>
                  <span>`,u+=n(d.key),u+=`</span>
                  `,d.value)u+=`
                    <span class="num text-subtle">`,u+=n(d.value),u+=`</span>
                  `;u+=`</li>
              `}u+=`</ul>
          `}}return u+="</figure>",u}}F(nn,{tag:"stacks-bar-chart",template:`<figure class="flex flex-col h-full m-0">
    @if (title)
      <figcaption class="mb-3 text-sm font-medium text-ink">{{ title }}</figcaption>
    @endif

    @if (empty)
      <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
        <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
        <p class="text-sm text-muted">{{ emptyMessage }}</p>
        <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
      </div>
    @else
      <div class="flex-1 min-h-0">
    <svg viewBox="0 0 {{ box.width }} {{ box.height }}" class="w-full h-full" role="img" aria-label="{{ title ?? 'Bar chart' }}" preserveAspectRatio="none">
      @foreach (gridlines as tick)
        <line x1="{{ box.left }}" x2="{{ box.width - box.right }}" y1="{{ tick.y }}" y2="{{ tick.y }}" stroke="var(--grid)" stroke-width="1" />
        <text x="{{ box.left - 8 }}" y="{{ tick.y + 4 }}" text-anchor="end" class="chart-tick">{{ tick.label }}</text>
      @endforeach

      @foreach (xLabels as label)
        <text x="{{ label.x }}" y="{{ box.height - 8 }}" text-anchor="middle" class="chart-tick">{{ label.label }}</text>
      @endforeach

      @foreach (rects as rect)
        {{-- 4px rounded ends, anchored to the baseline: the top reads as the
             value and the bottom stays flush with the axis. --}}
        <rect
          x="{{ rect.x }}" y="{{ rect.y }}"
          width="{{ rect.width }}" height="{{ rect.height }}"
          rx="4"
          fill="{{ color }}"
          class="chart-bar"
        >
          <title>{{ rect.when }}: {{ rect.display }}</title>
        </rect>
      @endforeach
    </svg>
      </div>

      @if (legend.length > 1)
        {{-- Always present for two or more series: identity must never rest on
             colour alone, and one adjacent pair in this palette sits in the
             band where a legend is the condition of the palette being usable.
             Text wears text tokens; the swatch carries the identity. --}}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
          @foreach (legend as entry)
            <li class="flex gap-2 items-center text-xs text-muted">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ entry.color }}"></span>
              <span>{{ entry.key }}</span>
              @if (entry.value)
                <span class="num text-subtle">{{ entry.value }}</span>
              @endif
            </li>
          @endforeach
        </ul>
      @endif
    @endif
  </figure>`,styles:`.chart-bar {
  transition: opacity 0.12s ease;
}

.chart-bar:hover {
  opacity: 0.82;
}

@media (prefers-reduced-motion: reduce) {
  .chart-bar { transition: none; }
}`,shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0},height:{type:"number",default:260,reflect:!0}},eventTypes:[],bindings:[]});var Ma=nn;class en extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s,unit:o="number",currency:l="USD",invert:h=!1}=this._props(),g=o==="currency"?_e(a.total,l):O(a.total),f=a.comparison?.change??null,y=f!==null&&f>0,c=f===null?null:h?!y:y,_=c===null?"text-subtle":c?"text-pos":"text-neg",p=f===null?"":y?"i-hugeicons-arrow-up-right":"i-hugeicons-arrow-down-right",m=a.total===0&&!a.comparison,u="";if(u+=`<div class="flex flex-col justify-center h-full">
        `,s)u+=`
          <p class="text-sm text-muted">`,u+=n(s),u+=`</p>
        `;if(u+='<p class="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl num text-ink">',u+=n(g),u+=`</p>

        `,f!==null)u+=`
          <p class="flex gap-1.5 items-center mt-2 text-sm `,u+=n(_),u+=`">
            <i class="w-4 h-4 `,u+=n(p),u+=`"></i>
            <span class="num">`,u+=n(ye(f)),u+=`</span>
            <span class="text-subtle">vs previous period</span>
          </p>
        `;else if(a.comparison)u+=`
      
          <p class="mt-2 text-sm text-subtle">No activity in the previous period</p>
        `;else if(m)u+=`
          <p class="mt-2 text-sm text-subtle">No events in this range</p>
        `;return u+="</div>",u}}F(en,{tag:"stacks-big-number",template:`<div class="flex flex-col justify-center h-full">
    @if (title)
      <p class="text-sm text-muted">{{ title }}</p>
    @endif

    {{-- Smaller on a phone. A headline number is the one piece of text that
         must never be clipped, and at 30px a formatted currency total is wider
         than a narrow block on a 375px screen. Shrinking beats truncating,
         because half a number is worse than no number. --}}
    <p class="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl num text-ink">{{ value }}</p>

    @if (change !== null)
      <p class="flex gap-1.5 items-center mt-2 text-sm {{ tone }}">
        <i class="w-4 h-4 {{ icon }}"></i>
        <span class="num">{{ delta(change) }}</span>
        <span class="text-subtle">vs previous period</span>
      </p>
    @elseif (result.comparison)
      {{-- Up from nothing is not a percentage, and rendering one is how a
           dashboard claims a 4000% rise because yesterday was zero. --}}
      <p class="mt-2 text-sm text-subtle">No activity in the previous period</p>
    @elseif (empty)
      <p class="mt-2 text-sm text-subtle">No events in this range</p>
    @endif
  </div>`,styles:"",shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0},unit:{type:"string",default:"number",reflect:!0},currency:{type:"string",default:"USD",reflect:!0},invert:{type:"boolean",default:!1,reflect:!0}},eventTypes:[],bindings:[]});var wa=en;class rn extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s,size:o=220}=this._props(),l=o/2-6,h=Me(a,l,Math.max(18,l*0.32)).map((p)=>({...p,display:O(p.value),percentLabel:`${Math.round(p.percent*100)}%`})),g=O(a.series.reduce((p,m)=>p+m.total,0)),f=h.map((p)=>({key:p.key,color:p.color,value:p.percentLabel})),y=h.length===0,c="No data in this range",_="";if(_+=`<figure class="flex flex-col h-full m-0">
        `,s)_+=`
          <figcaption class="mb-3 text-sm font-medium text-ink">`,_+=n(s),_+=`</figcaption>
        `;if(y)_+=`
          <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
            <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
            <p class="text-sm text-muted">`,_+=n("No data in this range"),_+=`</p>
            <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
          </div>
        `;else{_+=`<div class="flex-1 min-h-0">
        <div class="flex justify-center items-center h-full">
          <svg viewBox="-`,_+=n(o/2),_+=" -",_+=n(o/2),_+=" ",_+=n(o),_+=" ",_+=n(o),_+='" class="max-h-full" width="',_+=n(o),_+='" height="',_+=n(o),_+='" role="img" aria-label="',_+=n(s??"Share of total"),_+=`">
            `;for(let p of e(h))_+=`
              <path d="`,_+=n(p.path),_+='" fill="',_+=n(p.color),_+=`" class="chart-slice">
                <title>`,_+=n(p.key),_+=": ",_+=n(p.display),_+=" (",_+=n(p.percentLabel),_+=`)</title>
              </path>
            `;if(_+='<text x="0" y="-2" text-anchor="middle" class="donut-total">',_+=n(g),_+=`</text>
            <text x="0" y="16" text-anchor="middle" class="donut-caption">total</text>
          </svg>
        </div>
          </div>

          `,f.length>1){_+=`
        
            <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
              `;for(let p of e(f)){if(_+=`
                <li class="flex gap-2 items-center text-xs text-muted">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,_+=n(p.color),_+=`"></span>
                  <span>`,_+=n(p.key),_+=`</span>
                  `,p.value)_+=`
                    <span class="num text-subtle">`,_+=n(p.value),_+=`</span>
                  `;_+=`</li>
              `}_+=`</ul>
          `}}return _+="</figure>",_}}F(rn,{tag:"stacks-donut-chart",template:`<figure class="flex flex-col h-full m-0">
    @if (title)
      <figcaption class="mb-3 text-sm font-medium text-ink">{{ title }}</figcaption>
    @endif

    @if (empty)
      <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
        <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
        <p class="text-sm text-muted">{{ emptyMessage }}</p>
        <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
      </div>
    @else
      <div class="flex-1 min-h-0">
    <div class="flex justify-center items-center h-full">
      <svg viewBox="-{{ size / 2 }} -{{ size / 2 }} {{ size }} {{ size }}" class="max-h-full" width="{{ size }}" height="{{ size }}" role="img" aria-label="{{ title ?? 'Share of total' }}">
        @foreach (slices as slice)
          <path d="{{ slice.path }}" fill="{{ slice.color }}" class="chart-slice">
            <title>{{ slice.key }}: {{ slice.display }} ({{ slice.percentLabel }})</title>
          </path>
        @endforeach

        {{-- The total lives in the hole, which is the reason to leave one. --}}
        <text x="0" y="-2" text-anchor="middle" class="donut-total">{{ total }}</text>
        <text x="0" y="16" text-anchor="middle" class="donut-caption">total</text>
      </svg>
    </div>
      </div>

      @if (legend.length > 1)
        {{-- Always present for two or more series: identity must never rest on
             colour alone, and one adjacent pair in this palette sits in the
             band where a legend is the condition of the palette being usable.
             Text wears text tokens; the swatch carries the identity. --}}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
          @foreach (legend as entry)
            <li class="flex gap-2 items-center text-xs text-muted">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ entry.color }}"></span>
              <span>{{ entry.key }}</span>
              @if (entry.value)
                <span class="num text-subtle">{{ entry.value }}</span>
              @endif
            </li>
          @endforeach
        </ul>
      @endif
    @endif
  </figure>`,styles:`.donut-total {
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 600;
  fill: var(--text);
}

.donut-caption {
  font-size: 11px;
  fill: var(--text-3);
}

.chart-slice {
  transition: opacity 0.12s ease;
}

.chart-slice:hover {
  opacity: 0.82;
}

@media (prefers-reduced-motion: reduce) {
  .chart-slice { transition: none; }
}`,shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0},size:{type:"number",default:220,reflect:!0}},eventTypes:[],bindings:[]});var ma=rn;class sn extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s}=this._props(),o=(a.steps??[]).map((f,y,c)=>{let _=y===0?f.count:c[y-1].count;return{name:f.name,count:O(f.count),width:Math.max(2,f.rate*100),ofFirst:`${Math.round(f.rate*100)}%`,ofPrevious:_===0?"-":`${Math.round(f.count/_*100)}%`,dropped:y===0?null:O(Math.max(0,_-f.count)),color:L(y)}}),l=o.length===0||o.every((f)=>f.count==="0"),h=[],g="";if(g+=`<figure class="flex flex-col h-full m-0">
        `,s)g+=`
          <figcaption class="mb-3 text-sm font-medium text-ink">`,g+=n(s),g+=`</figcaption>
        `;if(l)g+=`
          <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
            <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
            <p class="text-sm text-muted">`,g+=n(emptyMessage),g+=`</p>
            <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
          </div>
        `;else{g+=`<div class="flex-1 min-h-0">
        <ol class="flex flex-col gap-3 justify-center py-1 h-full list-none">
          `;for(let f of e(o)){if(g+=`
            <li>
              <div class="flex gap-3 justify-between items-baseline mb-1">
                <span class="text-sm text-ink">`,g+=n(f.name),g+=`</span>
                <span class="flex gap-3 items-baseline text-xs">
                  <span class="num text-ink">`,g+=n(f.count),g+=`</span>
                  <span class="num text-subtle">`,g+=n(f.ofFirst),g+=`</span>
                </span>
              </div>
              <div class="overflow-hidden h-2.5 rounded-full bg-canvas">
                <div class="h-full rounded-full" style="width: `,g+=n(f.width),g+="%; background: ",g+=n(f.color),g+=`"></div>
              </div>
              `,f.dropped)g+=`
                <p class="mt-1 text-xs text-subtle">
                  <span class="num">`,g+=n(f.ofPrevious),g+=`</span> of the previous step,
                  <span class="num">`,g+=n(f.dropped),g+=`</span> dropped
                </p>
              `;g+=`</li>
          `}if(g+=`</ol>
          </div>

          `,h.length>1){g+=`
        
            <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
              `;for(let f of e(h)){if(g+=`
                <li class="flex gap-2 items-center text-xs text-muted">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,g+=n(f.color),g+=`"></span>
                  <span>`,g+=n(f.key),g+=`</span>
                  `,f.value)g+=`
                    <span class="num text-subtle">`,g+=n(f.value),g+=`</span>
                  `;g+=`</li>
              `}g+=`</ul>
          `}}return g+="</figure>",g}}F(sn,{tag:"stacks-funnel-chart",template:`<figure class="flex flex-col h-full m-0">
    @if (title)
      <figcaption class="mb-3 text-sm font-medium text-ink">{{ title }}</figcaption>
    @endif

    @if (empty)
      <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
        <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
        <p class="text-sm text-muted">{{ emptyMessage }}</p>
        <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
      </div>
    @else
      <div class="flex-1 min-h-0">
    <ol class="flex flex-col gap-3 justify-center py-1 h-full list-none">
      @foreach (steps as step)
        <li>
          <div class="flex gap-3 justify-between items-baseline mb-1">
            <span class="text-sm text-ink">{{ step.name }}</span>
            <span class="flex gap-3 items-baseline text-xs">
              <span class="num text-ink">{{ step.count }}</span>
              <span class="num text-subtle">{{ step.ofFirst }}</span>
            </span>
          </div>
          <div class="overflow-hidden h-2.5 rounded-full bg-canvas">
            <div class="h-full rounded-full" style="width: {{ step.width }}%; background: {{ step.color }}"></div>
          </div>
          @if (step.dropped)
            <p class="mt-1 text-xs text-subtle">
              <span class="num">{{ step.ofPrevious }}</span> of the previous step,
              <span class="num">{{ step.dropped }}</span> dropped
            </p>
          @endif
        </li>
      @endforeach
    </ol>
      </div>

      @if (legend.length > 1)
        {{-- Always present for two or more series: identity must never rest on
             colour alone, and one adjacent pair in this palette sits in the
             band where a legend is the condition of the palette being usable.
             Text wears text tokens; the swatch carries the identity. --}}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
          @foreach (legend as entry)
            <li class="flex gap-2 items-center text-xs text-muted">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ entry.color }}"></span>
              <span>{{ entry.key }}</span>
              @if (entry.value)
                <span class="num text-subtle">{{ entry.value }}</span>
              @endif
            </li>
          @endforeach
        </ul>
      @endif
    @endif
  </figure>`,styles:"",shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0}},eventTypes:[],bindings:[]});var Ta=sn;class an extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s,rowLabels:o=[]}=this._props(),l=Math.max(1,...a.series.flatMap((_)=>_.points.map((p)=>p.value))),h=a.series.map((_,p)=>({label:o[p]??(_.key==="total"?"All events":_.key),cells:_.points.map((m)=>({opacity:m.value===0?0:0.15+m.value/l*0.85,value:O(m.value),when:Tt(m.t,a.grain)}))})),g=l<=1&&h.every((_)=>_.cells.every((p)=>p.value==="0")),f=[],y="No data in this range",c="";if(c+=`<figure class="flex flex-col h-full m-0">
        `,s)c+=`
          <figcaption class="mb-3 text-sm font-medium text-ink">`,c+=n(s),c+=`</figcaption>
        `;if(g)c+=`
          <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
            <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
            <p class="text-sm text-muted">`,c+=n("No data in this range"),c+=`</p>
            <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
          </div>
        `;else{c+=`<div class="flex-1 min-h-0">
        <div class="flex flex-col gap-2 justify-center h-full">
          `;for(let _ of e(h)){c+=`
            <div class="flex gap-3 items-center">
              <span class="w-24 text-xs truncate shrink-0 text-muted">`,c+=n(_.label),c+=`</span>
              <div class="flex flex-1 gap-0.5">
                `;for(let p of e(_.cells))c+=`
              
                  <div
                    class="flex-1 h-6 rounded-sm border heat-cell border-line"
                    style="background: color-mix(in srgb, var(--series-1) `,c+=n(p.opacity*100),c+=`%, transparent)"
                    title="`,c+=n(p.when),c+=": ",c+=n(p.value),c+=`"
                  ></div>
                `;c+=`</div>
            </div>
          `}if(c+=`<div class="flex gap-2 justify-end items-center mt-1 text-xs text-subtle">
            <span>0</span>
            <div class="flex gap-0.5">
              <div class="w-4 h-2.5 rounded-sm" style="background: color-mix(in srgb, var(--series-1) 15%, transparent)"></div>
              <div class="w-4 h-2.5 rounded-sm" style="background: color-mix(in srgb, var(--series-1) 40%, transparent)"></div>
              <div class="w-4 h-2.5 rounded-sm" style="background: color-mix(in srgb, var(--series-1) 70%, transparent)"></div>
              <div class="w-4 h-2.5 rounded-sm" style="background: var(--series-1)"></div>
            </div>
            <span class="num">`,c+=n(O(l)),c+=`</span>
          </div>
        </div>
          </div>

          `,f.length>1){c+=`
        
            <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
              `;for(let _ of e(f)){if(c+=`
                <li class="flex gap-2 items-center text-xs text-muted">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,c+=n(_.color),c+=`"></span>
                  <span>`,c+=n(_.key),c+=`</span>
                  `,_.value)c+=`
                    <span class="num text-subtle">`,c+=n(_.value),c+=`</span>
                  `;c+=`</li>
              `}c+=`</ul>
          `}}return c+="</figure>",c}}F(an,{tag:"stacks-heatmap-chart",template:`<figure class="flex flex-col h-full m-0">
    @if (title)
      <figcaption class="mb-3 text-sm font-medium text-ink">{{ title }}</figcaption>
    @endif

    @if (empty)
      <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
        <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
        <p class="text-sm text-muted">{{ emptyMessage }}</p>
        <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
      </div>
    @else
      <div class="flex-1 min-h-0">
    <div class="flex flex-col gap-2 justify-center h-full">
      @foreach (rows as row)
        <div class="flex gap-3 items-center">
          <span class="w-24 text-xs truncate shrink-0 text-muted">{{ row.label }}</span>
          <div class="flex flex-1 gap-0.5">
            @foreach (row.cells as cell)
              {{-- A 2px gap between cells, so adjacent values never merge into
                   one block. --}}
              <div
                class="flex-1 h-6 rounded-sm border heat-cell border-line"
                style="background: color-mix(in srgb, var(--series-1) {{ cell.opacity * 100 }}%, transparent)"
                title="{{ cell.when }}: {{ cell.value }}"
              ></div>
            @endforeach
          </div>
        </div>
      @endforeach

      <div class="flex gap-2 justify-end items-center mt-1 text-xs text-subtle">
        <span>0</span>
        <div class="flex gap-0.5">
          <div class="w-4 h-2.5 rounded-sm" style="background: color-mix(in srgb, var(--series-1) 15%, transparent)"></div>
          <div class="w-4 h-2.5 rounded-sm" style="background: color-mix(in srgb, var(--series-1) 40%, transparent)"></div>
          <div class="w-4 h-2.5 rounded-sm" style="background: color-mix(in srgb, var(--series-1) 70%, transparent)"></div>
          <div class="w-4 h-2.5 rounded-sm" style="background: var(--series-1)"></div>
        </div>
        <span class="num">{{ compact(max) }}</span>
      </div>
    </div>
      </div>

      @if (legend.length > 1)
        {{-- Always present for two or more series: identity must never rest on
             colour alone, and one adjacent pair in this palette sits in the
             band where a legend is the condition of the palette being usable.
             Text wears text tokens; the swatch carries the identity. --}}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
          @foreach (legend as entry)
            <li class="flex gap-2 items-center text-xs text-muted">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ entry.color }}"></span>
              <span>{{ entry.key }}</span>
              @if (entry.value)
                <span class="num text-subtle">{{ entry.value }}</span>
              @endif
            </li>
          @endforeach
        </ul>
      @endif
    @endif
  </figure>`,styles:`.heat-cell {
  transition: outline-color 0.12s ease;
  outline: 2px solid transparent;
}

.heat-cell:hover {
  outline-color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .heat-cell { transition: none; }
}`,shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0},rowLabels:{type:"object",default:[],reflect:!0}},eventTypes:[],bindings:[]});var ba=an;class on extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s,variant:o="line",height:l=260}=this._props(),h={...At,height:l},g=Bt(a,h),f=Kt(a,g),y=Qt(a,g,(d)=>tn(d,a.grain)),c=a.series.every((d)=>d.points.every((T)=>T.value===0)),_=a.series.map((d,T)=>({key:d.key,color:L(T,d.key),line:xe(d,g),fill:o==="area"&&a.series.length===1?de(d,g):"",total:O(d.total),points:d.points.map((S,D)=>({cx:g.x(D),cy:g.y(S.value),value:O(S.value),label:Tt(S.t,a.grain)}))})),p=_.map((d)=>({key:d.key,color:d.color,value:d.total})),m="No data in this range",u="";if(u+=`<figure class="flex flex-col h-full m-0">
        `,s)u+=`
          <figcaption class="mb-3 text-sm font-medium text-ink">`,u+=n(s),u+=`</figcaption>
        `;if(c)u+=`
          <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
            <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
            <p class="text-sm text-muted">`,u+=n("No data in this range"),u+=`</p>
            <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
          </div>
        `;else{u+=`<div class="flex-1 min-h-0">
        <svg
          viewBox="0 0 `,u+=n(h.width),u+=" ",u+=n(h.height),u+=`"
          class="w-full h-full chart"
          role="img"
          aria-label="`,u+=n(s??"Time series"),u+=`"
          preserveAspectRatio="none"
        >
      
          `;for(let d of e(f))u+=`
            <line
              x1="`,u+=n(h.left),u+='" x2="',u+=n(h.width-h.right),u+=`"
              y1="`,u+=n(d.y),u+='" y2="',u+=n(d.y),u+=`"
              stroke="var(--grid)" stroke-width="1"
            />
            <text
              x="`,u+=n(h.left-8),u+='" y="',u+=n(d.y+4),u+=`"
              text-anchor="end"
              class="chart-tick"
            >`,u+=n(d.label),u+=`</text>
          `;for(let d of e(y))u+=`
            <text x="`,u+=n(d.x),u+='" y="',u+=n(h.height-8),u+='" text-anchor="middle" class="chart-tick">',u+=n(d.label),u+=`</text>
          `;for(let d of e(_)){if(u+=`
            `,d.fill)u+=`
              <path d="`,u+=n(d.fill),u+='" fill="',u+=n(d.color),u+=`" opacity="0.12" />
            `;u+=`<path
              d="`,u+=n(d.line),u+=`"
              fill="none"
              stroke="`,u+=n(d.color),u+=`"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          `}for(let d of e(_)){u+=`
            `;for(let T of e(d.points))u+=`
              <circle
                cx="`,u+=n(T.cx),u+='" cy="',u+=n(T.cy),u+=`" r="9"
                fill="transparent"
                class="chart-hit"
                data-label="`,u+=n(T.label),u+=`"
                data-series="`,u+=n(d.key),u+=`"
                data-value="`,u+=n(T.value),u+=`"
              />
              <circle
                cx="`,u+=n(T.cx),u+='" cy="',u+=n(T.cy),u+=`" r="4"
                fill="`,u+=n(d.color),u+=`"
                stroke="var(--panel)"
                stroke-width="2"
                class="chart-dot"
              />
            `}if(u+=`</svg>
          </div>

          `,p.length>1){u+=`
        
            <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
              `;for(let d of e(p)){if(u+=`
                <li class="flex gap-2 items-center text-xs text-muted">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,u+=n(d.color),u+=`"></span>
                  <span>`,u+=n(d.key),u+=`</span>
                  `,d.value)u+=`
                    <span class="num text-subtle">`,u+=n(d.value),u+=`</span>
                  `;u+=`</li>
              `}u+=`</ul>
          `}}return u+="</figure>",u}}F(on,{tag:"stacks-line-chart",template:`<figure class="flex flex-col h-full m-0">
    @if (title)
      <figcaption class="mb-3 text-sm font-medium text-ink">{{ title }}</figcaption>
    @endif

    @if (empty)
      <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
        <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
        <p class="text-sm text-muted">{{ emptyMessage }}</p>
        <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
      </div>
    @else
      <div class="flex-1 min-h-0">
    <svg
      viewBox="0 0 {{ box.width }} {{ box.height }}"
      class="w-full h-full chart"
      role="img"
      aria-label="{{ title ?? 'Time series' }}"
      preserveAspectRatio="none"
    >
      {{-- Gridlines sit under the data and never compete with it. --}}
      @foreach (gridlines as tick)
        <line
          x1="{{ box.left }}" x2="{{ box.width - box.right }}"
          y1="{{ tick.y }}" y2="{{ tick.y }}"
          stroke="var(--grid)" stroke-width="1"
        />
        <text
          x="{{ box.left - 8 }}" y="{{ tick.y + 4 }}"
          text-anchor="end"
          class="chart-tick"
        >{{ tick.label }}</text>
      @endforeach

      @foreach (xLabels as label)
        <text x="{{ label.x }}" y="{{ box.height - 8 }}" text-anchor="middle" class="chart-tick">{{ label.label }}</text>
      @endforeach

      @foreach (series as entry)
        @if (entry.fill)
          <path d="{{ entry.fill }}" fill="{{ entry.color }}" opacity="0.12" />
        @endif
        {{-- 2px, round joins: thin enough to read as data, thick enough to
             follow across a gridline. --}}
        <path
          d="{{ entry.line }}"
          fill="none"
          stroke="{{ entry.color }}"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      @endforeach

      {{-- Hover targets, one per point per series. Invisible until hovered, and
           larger than the dot they reveal so they are actually hittable. --}}
      @foreach (series as entry)
        @foreach (entry.points as point)
          <circle
            cx="{{ point.cx }}" cy="{{ point.cy }}" r="9"
            fill="transparent"
            class="chart-hit"
            data-label="{{ point.label }}"
            data-series="{{ entry.key }}"
            data-value="{{ point.value }}"
          />
          <circle
            cx="{{ point.cx }}" cy="{{ point.cy }}" r="4"
            fill="{{ entry.color }}"
            stroke="var(--panel)"
            stroke-width="2"
            class="chart-dot"
          />
        @endforeach
      @endforeach
    </svg>
      </div>

      @if (legend.length > 1)
        {{-- Always present for two or more series: identity must never rest on
             colour alone, and one adjacent pair in this palette sits in the
             band where a legend is the condition of the palette being usable.
             Text wears text tokens; the swatch carries the identity. --}}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
          @foreach (legend as entry)
            <li class="flex gap-2 items-center text-xs text-muted">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ entry.color }}"></span>
              <span>{{ entry.key }}</span>
              @if (entry.value)
                <span class="num text-subtle">{{ entry.value }}</span>
              @endif
            </li>
          @endforeach
        </ul>
      @endif
    @endif
  </figure>`,styles:`/* Dots appear on hover only: a dot per point per series is noise at 30 points,
 * and the line is the shape being read. */
.chart-dot {
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
}

.chart-hit:hover + .chart-dot {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .chart-dot { transition: none; }
}`,shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0},variant:{type:"string",default:"line",reflect:!0},height:{type:"number",default:260,reflect:!0}},eventTypes:[],bindings:[]});var Na=on;class hn extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{result:a,title:s,label:o="Series"}=this._props(),l=a.series.reduce((_,p)=>_+p.total,0),h=a.series.slice().sort((_,p)=>p.total-_.total).map((_,p)=>({key:_.key==="total"?s||"Total":_.key,color:L(p,_.key),value:O(_.total),share:l>0?`${Math.round(_.total/l*100)}%`:"-"})),g=h.length===0||l===0,f=[],y="No data in this range",c="";if(c+=`<figure class="flex flex-col h-full m-0">
        `,s)c+=`
          <figcaption class="mb-3 text-sm font-medium text-ink">`,c+=n(s),c+=`</figcaption>
        `;if(g)c+=`
          <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
            <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
            <p class="text-sm text-muted">`,c+=n("No data in this range"),c+=`</p>
            <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
          </div>
        `;else{c+=`<div class="flex-1 min-h-0">
        <div class="overflow-auto h-full">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="text-left border-b border-line">
                <th class="py-2 pr-3 text-xs font-medium text-subtle">`,c+=n(o),c+=`</th>
                <th class="py-2 px-3 text-xs font-medium text-right text-subtle">Value</th>
                <th class="py-2 pl-3 text-xs font-medium text-right text-subtle">Share</th>
              </tr>
            </thead>
            <tbody>
              `;for(let _ of e(h))c+=`
                <tr class="border-b border-line last:border-0">
                  <td class="py-2 pr-3">
                    <span class="flex gap-2 items-center text-ink">
                      <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,c+=n(_.color),c+=`"></span>
                      `,c+=n(_.key),c+=`
                    </span>
                  </td>
                  <td class="py-2 px-3 text-right num text-ink">`,c+=n(_.value),c+=`</td>
                  <td class="py-2 pl-3 text-right num text-muted">`,c+=n(_.share),c+=`</td>
                </tr>
              `;if(c+=`</tbody>
          </table>
        </div>
          </div>

          `,f.length>1){c+=`
        
            <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
              `;for(let _ of e(f)){if(c+=`
                <li class="flex gap-2 items-center text-xs text-muted">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: `,c+=n(_.color),c+=`"></span>
                  <span>`,c+=n(_.key),c+=`</span>
                  `,_.value)c+=`
                    <span class="num text-subtle">`,c+=n(_.value),c+=`</span>
                  `;c+=`</li>
              `}c+=`</ul>
          `}}return c+="</figure>",c}}F(hn,{tag:"stacks-table-chart",template:`<figure class="flex flex-col h-full m-0">
    @if (title)
      <figcaption class="mb-3 text-sm font-medium text-ink">{{ title }}</figcaption>
    @endif

    @if (empty)
      <div class="flex flex-1 flex-col gap-1 justify-center items-center py-8 text-center">
        <i class="w-5 h-5 text-subtle i-hugeicons-chart-line-data-01"></i>
        <p class="text-sm text-muted">{{ emptyMessage }}</p>
        <p class="text-xs text-subtle">Events that arrive later will appear here.</p>
      </div>
    @else
      <div class="flex-1 min-h-0">
    <div class="overflow-auto h-full">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left border-b border-line">
            <th class="py-2 pr-3 text-xs font-medium text-subtle">{{ label }}</th>
            <th class="py-2 px-3 text-xs font-medium text-right text-subtle">Value</th>
            <th class="py-2 pl-3 text-xs font-medium text-right text-subtle">Share</th>
          </tr>
        </thead>
        <tbody>
          @foreach (rows as row)
            <tr class="border-b border-line last:border-0">
              <td class="py-2 pr-3">
                <span class="flex gap-2 items-center text-ink">
                  <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ row.color }}"></span>
                  {{ row.key }}
                </span>
              </td>
              <td class="py-2 px-3 text-right num text-ink">{{ row.value }}</td>
              <td class="py-2 pl-3 text-right num text-muted">{{ row.share }}</td>
            </tr>
          @endforeach
        </tbody>
      </table>
    </div>
      </div>

      @if (legend.length > 1)
        {{-- Always present for two or more series: identity must never rest on
             colour alone, and one adjacent pair in this palette sits in the
             band where a legend is the condition of the palette being usable.
             Text wears text tokens; the swatch carries the identity. --}}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 items-center pt-3 mt-3 list-none border-t border-line">
          @foreach (legend as entry)
            <li class="flex gap-2 items-center text-xs text-muted">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background: {{ entry.color }}"></span>
              <span>{{ entry.key }}</span>
              @if (entry.value)
                <span class="num text-subtle">{{ entry.value }}</span>
              @endif
            </li>
          @endforeach
        </ul>
      @endif
    @endif
  </figure>`,styles:"",shadowMode:!1,progressive:!0,properties:{result:{type:"object",reflect:!0},title:{type:"string",reflect:!0},label:{type:"string",default:"Series",reflect:!0}},eventTypes:[],bindings:[]});var ka=hn;class ln extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{body:a,title:s}=this._props(),o="";if(o+=`<div class="flex flex-col justify-center h-full">
        `,s)o+=`
          <p class="mb-1 text-sm font-medium text-ink">`,o+=n(s),o+=`</p>
        `;return o+='<p class="max-w-[65ch] text-sm text-muted leading-relaxed">',o+=n(a),o+=`</p>
      </div>`,o}}F(ln,{tag:"stacks-text-block",template:`<div class="flex flex-col justify-center h-full">
    @if (title)
      <p class="mb-1 text-sm font-medium text-ink">{{ title }}</p>
    @endif
    <p class="max-w-[65ch] text-sm text-muted leading-relaxed">{{ body }}</p>
  </div>`,styles:"",shadowMode:!1,progressive:!0,properties:{body:{type:"string",reflect:!0},title:{type:"string",reflect:!0}},eventTypes:[],bindings:[]});var $a=ln;class un extends A{render(t){let{escape:n,raw:i,values:e,entries:r}=t,{size:a="md",markOnly:s=!1}=this._props(),o={sm:"h-4 w-4",md:"h-5 w-5",lg:"h-7 w-7"}[a],l={sm:"text-sm",md:"text-base",lg:"text-xl"}[a],h="";if(h+=`
      <span class="inline-flex gap-2 items-center select-none">
        <svg
          class="`,h+=n(o),h+=`"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="1.5" y="12" width="4" height="6.5" rx="1" fill="currentColor" opacity="0.45" />
          <rect x="8" y="7.5" width="4" height="11" rx="1" fill="currentColor" opacity="0.72" />
          <rect x="14.5" y="1.5" width="4" height="17" rx="1" fill="currentColor" />
        </svg>

        `,!s)h+=`
      
          <span class="`,h+=n(l),h+=` font-semibold tracking-tight text-ink">
            Reports<span class="font-bold">HQ</span>
          </span>
        `;return h+="</span>",h}}F(un,{tag:"stacks-wordmark",template:`{{-- The mark is three ascending bars: the smallest honest drawing of a
       report, and the only hand-drawn vector in the product. Everything else
       uses Iconify. It inherits currentColor so it works on the canvas, inside
       a filled button, and on a dark share page without a second copy. --}}
  <span class="inline-flex gap-2 items-center select-none">
    <svg
      class="{{ markSize }}"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="12" width="4" height="6.5" rx="1" fill="currentColor" opacity="0.45" />
      <rect x="8" y="7.5" width="4" height="11" rx="1" fill="currentColor" opacity="0.72" />
      <rect x="14.5" y="1.5" width="4" height="17" rx="1" fill="currentColor" />
    </svg>

    @if (!markOnly)
      {{-- "HQ" carries the weight so the lockup has a focal point without a
           second typeface or a colour change. --}}
      <span class="{{ textSize }} font-semibold tracking-tight text-ink">
        Reports<span class="font-bold">HQ</span>
      </span>
    @endif
  </span>`,styles:"",shadowMode:!1,progressive:!0,properties:{size:{type:"string",default:"md",reflect:!0},markOnly:{type:"boolean",default:!1,reflect:!0}},eventTypes:[],bindings:[]});var va=un;export{va as WordmarkElement,un as Wordmark,$a as TextBlockElement,ln as TextBlock,ka as TableChartElement,hn as TableChart,Na as LineChartElement,on as LineChart,ba as HeatmapChartElement,an as HeatmapChart,Ta as FunnelChartElement,sn as FunnelChart,ma as DonutChartElement,rn as DonutChart,wa as BigNumberElement,en as BigNumber,Ma as BarChartElement,nn as BarChart};

//# debugId=A59242FB177CD5E064756E2164756E21
