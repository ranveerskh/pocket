export default function RenderQuality({value,onChange,disabled,dimensions,aspect}:{value:string;onChange:(value:string)=>void;disabled:boolean;dimensions:number[];aspect:string}){
 const choices=[{value:'draft',label:'Smaller'},{value:'balanced',label:'Balanced'},{value:'high',label:'High'}];
 return <section className="queue-quality" aria-label="Render quality"><div className="queue-quality-heading"><strong>Quality</strong><span>{dimensions[0]} × {dimensions[1]} · {aspect}</span></div><div className="queue-quality-switch" role="group" aria-label="Choose render quality">{choices.map(choice=><button key={choice.value} type="button" aria-pressed={value===choice.value} disabled={disabled} onClick={()=>onChange(choice.value)}>{choice.label}</button>)}</div></section>;
}
