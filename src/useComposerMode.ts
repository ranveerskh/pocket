import {useState} from 'react';
import {localStorage} from './local-mode';
const KEY='pocket-composer-mode';
export function useComposerMode(){
 const [bulk,setBulk]=useState(()=>{try{return localStorage.getItem(KEY)==='bulk';}catch{return false;}});
 const [error,setError]=useState('');
 function choose(next:boolean){setBulk(next);try{localStorage.setItem(KEY,next?'bulk':'single');setError('');}catch{setError('This browser could not remember Single/Bulk mode.');}}
 return{bulk,choose,error};
}
