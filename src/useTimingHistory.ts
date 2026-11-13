import {localStorage} from './local-mode';
import {useEffect,useState} from 'react';
import type {Job} from './vault';
import {mergeTimingSamples,readTimingSamples,saveTimingSamples} from './timing';
export function useTimingHistory(jobs:Job[]){
 const [samples,setSamples]=useState(()=>readTimingSamples(localStorage));
 useEffect(()=>{setSamples(previous=>{const next=mergeTimingSamples(previous,jobs);try{saveTimingSamples(localStorage,next);}catch{}return JSON.stringify(next)===JSON.stringify(previous)?previous:next;});},[jobs]);
 return samples;
}
